// OWNER: A — 4단계에서 확정: 원본은 `sources/<파일명>` 에 두고 출처 페이지 `sources/@<이름>.md` 가
// 짝이 된다 (ADR-0002 결정 6). `sources/files/` · `sources/text/` 는 쓰지 않는다.
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { NotePath, Vault } from "../../shared/types.ts";
import { assertAgentWritable } from "../vault/paths.ts";
import { hash8Bytes } from "./wiki.ts";

/**
 * 볼트 밖 원본을 `sources/` 로 복사한다.
 *
 * 이름 충돌 규칙: 같은 이름에 같은 내용이면 그 파일을 그대로 쓴다(중복 반입 아님 — 입력 벽 7 이
 * raw_hash 로 건너뛴다). 같은 이름에 다른 내용이면 ` (2)`, ` (3)` 을 붙인다 — 남의 파일을 덮지 않는다.
 */
export async function copyIntoSources(v: Vault, file: string): Promise<NotePath> {
  const data = await readFile(file);
  const ext = extname(file);
  const stem = basename(file, ext);
  for (let n = 1; ; n++) {
    const dest: NotePath = `sources/${n === 1 ? stem : `${stem} (${n})`}${ext}`;
    await assertAgentWritable(v, dest);
    const abs = join(v.root, dest);
    const there = await stat(abs).then(
      () => true,
      () => false,
    );
    if (!there) {
      await mkdir(join(v.root, "sources"), { recursive: true });
      await copyFile(file, abs);
      return dest;
    }
    if (hash8Bytes(await readFile(abs)) === hash8Bytes(data)) return dest;
  }
}
