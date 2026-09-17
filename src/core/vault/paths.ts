// FROZEN: 파일 전체 — 경로 방어의 단일 지점 (0단계 설계 §8, 상위 §9)
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { NotePath, Vault } from "../../shared/types.ts";
import { PiecePoolError } from "../errors.ts";

/**
 * 볼트 밖 경로 탈출을 막는 단일 방어 지점이다.
 * resolve 후 루트 접두사 검사 + realpath 로 심볼릭 링크 우회까지 차단한다.
 * 경로 검증을 여기 말고 다른 곳에 두지 않는다.
 */
export async function resolveInVault(v: Vault, p: NotePath): Promise<string> {
  // 루트부터 realpath 로 편다. macOS 의 /tmp → /private/tmp 처럼 루트 자체가
  // 심링크면, 편 대상과 안 편 루트를 비교하게 되어 정상 경로가 탈출로 보인다.
  const root = await realpath(v.root);

  // isAbsolute(p) 면 resolve 가 root 를 무시하고 p 를 그대로 돌려준다 —
  // 그래서 resolve 만으로는 막히지 않는다. 아래 contains 가 그것까지 잡는다.
  const abs = resolve(root, p);
  if (!contains(root, abs)) throw escape(p);

  // 여기까지는 문자열 계산이다. 심링크는 편 뒤에 다시 봐야 한다 —
  // 볼트 안의 link.md 가 볼트 밖을 가리키면 위 검사는 통과한다.
  const real = await realpath(abs);
  if (!contains(root, real)) throw escape(p);

  return real;
}

/** root 의 진짜 하위인가. root 자신은 파일이 아니므로 제외한다. */
function contains(root: string, target: string): boolean {
  const rel = relative(root, target);
  // "" 은 루트 자신, 절대경로면 다른 드라이브다(Windows 에서 relative 가 절대경로를 돌려준다).
  // ".." 는 접두사가 아니라 경로 조각으로 봐야 한다 — 그냥 startsWith 면
  // 볼트 안에 실재하는 `..foo.md` 같은 파일명까지 탈출로 거부한다.
  if (rel === "" || isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(".." + sep);
}

function escape(p: NotePath): PiecePoolError {
  return new PiecePoolError("path_escape", `볼트 밖 경로다: ${p}`);
}

/**
 * 에이전트 쓰기 대상인지 검사한다. `.md` 만 허용한다.
 *
 * 허용 루트는 `agentWriteRoots`(기본 wiki/ · sources/ · .piecepool/) **와 `inbox/`** 다 —
 * (ADR-0002 결정 6 으로 셋이 됐다. sources/ 에는 .md 가 아닌 원본 복사본도 쓴다 — 4단계에서 반영.)
 * 상위 §4.1 이 "에이전트의 쓰기 대상은 wiki/·inbox/ 로 한정한다" 로 규정하고,
 * processInbox 가 편입 후 단편을 지우려면 inbox/ 쓰기가 필요하다.
 *
 * inbox/ 정리도 이 함수를 통과한다. 호출부가 우회하면
 * 상위 §9 가 "단일 방어 지점" 이라 부른 자리가 조용히 둘이 된다.
 */
export async function assertAgentWritable(v: Vault, p: NotePath): Promise<void> {
  const bad = (why: string) =>
    new PiecePoolError("path_escape", `에이전트가 쓸 수 없는 경로다: ${p} — ${why}`);
  if (p === "" || isAbsolute(p) || p.includes("\\")) throw bad("볼트 기준 POSIX 상대경로만");
  const parts = p.split("/");
  if (parts.some((s) => s === "" || s === "." || s === ".."))
    throw bad("빈 조각이나 .. 은 안 된다");
  const roots = [...v.agentWriteRoots, "inbox"];
  if (parts.length < 2 || !roots.includes(parts[0])) throw bad(`${roots.join(" · ")} 아래만`);
  // wiki/ 와 inbox/ 는 .md 만. sources/ 에는 원본 복사본(pdf 등), .piecepool/ 에는 상태 파일이 온다
  // (ADR-0002 결정 6, 2026-09-15 합의).
  if ((parts[0] === "wiki" || parts[0] === "inbox") && !p.toLowerCase().endsWith(".md")) {
    throw bad(".md 만 쓴다");
  }
  // 새 파일은 realpath 가 없다. 이미 있는 가장 가까운 조상으로 심링크 우회를 본다.
  for (let n = parts.length; n >= 1; n--) {
    const ancestor = parts.slice(0, n).join("/");
    try {
      await realpath(resolve(v.root, ancestor));
    } catch {
      continue;
    }
    await resolveInVault(v, ancestor);
    return;
  }
}
