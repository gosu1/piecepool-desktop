// 트랜잭션 — ADR-0002 결정 7. 여러 파일을 한 번에 쓰고, 실패하면 전부 되돌린다.
//
//   0. 감시자 무시 등록   — 데모에는 감시자가 없다. 제품에서는 Written 경로를 index/watch 에 등록한다
//   1. 편집중 확인        — 데모에는 앱 편집기가 없다. 제품에서는 보류 목록으로 보낸다
//   2. 파일 존재 확인     — 갱신 대상이 사라졌으면(삭제·이름 변경) 취소한다
//   3. hashes 선행조건    — 호출부(index.ts)가 한다. 다시 읽어 다르면 빌더를 다시 돌린다
//   4. .bak               — 원본을 복사한다
//   5. tmp                — 새 내용을 옆에 쓴다
//   6. rename             — EPERM/EBUSY 면 지수 백오프로 최대 5회
//   7. 실패               — .bak 에서 복원하고 tmp/.bak 을 치운다
//   8. 성공               — .bak 을 지운다
//
// Windows 에서 완전한 원자성은 없다. 목표는 "실패를 감지하고 되돌릴 수 있다"다.

import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type FileWrite = {
  path: string;
  content: string;
  /** true 면 대상이 이미 있어야 한다(갱신). 없으면 사라진 것이므로 취소한다. */
  mustExist?: boolean;
};

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function renameWithBackoff(from: string, to: string): Promise<void> {
  const waits = [50, 100, 200, 400, 800];
  for (let i = 0; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY") || i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

/**
 * 파일들을 한 트랜잭션으로 쓴다. 하나라도 실패하면 이미 바꾼 것을 .bak 에서 되돌린다.
 * 되돌리기까지 실패하면 그 사실을 오류에 담는다 — 그때는 볼트 git 이 마지막 그물이다.
 */
export async function commitFiles(files: FileWrite[]): Promise<void> {
  // 2. 존재 확인 — 쓰기 전에 전부 본다. 하나라도 사라졌으면 아무것도 안 쓴다.
  for (const f of files) {
    if (f.mustExist && !(await exists(f.path))) {
      throw new Error(`대상이 사라졌습니다: ${f.path}`);
    }
  }

  const backed: string[] = [];
  const replaced: string[] = [];
  const created: string[] = [];
  try {
    for (const f of files) {
      await mkdir(dirname(f.path), { recursive: true });
      const had = await exists(f.path);
      if (had) {
        await copyFile(f.path, f.path + ".bak"); // 4
        backed.push(f.path);
      }
      await writeFile(f.path + ".tmp", f.content, "utf8"); // 5
      await renameWithBackoff(f.path + ".tmp", f.path); // 6
      (had ? replaced : created).push(f.path);
    }
  } catch (e: unknown) {
    // 7. 복원
    const failures: string[] = [];
    for (const p of replaced) {
      try {
        await copyFile(p + ".bak", p);
      } catch {
        failures.push(p);
      }
    }
    for (const p of created) await rm(p, { force: true });
    for (const f of files) await rm(f.path + ".tmp", { force: true });
    for (const p of backed) await rm(p + ".bak", { force: true });
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      failures.length
        ? `쓰기 실패 후 복원도 실패했습니다 (${failures.join(", ")}) — 볼트 git 에서 되돌리십시오. 원인: ${msg}`
        : `쓰기 실패, 되돌렸습니다. 원인: ${msg}`,
    );
  }
  // 8
  for (const p of backed) await rm(p + ".bak", { force: true });
}
