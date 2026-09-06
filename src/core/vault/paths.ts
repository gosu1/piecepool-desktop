import type { NotePath, Vault } from "../../shared/types.ts";

/**
 * 볼트 밖 경로 탈출을 막는 단일 방어 지점이다.
 * resolve 후 루트 접두사 검사 + realpath 로 심볼릭 링크 우회까지 차단한다.
 * 경로 검증을 여기 말고 다른 곳에 두지 않는다.
 */
export async function resolveInVault(v: Vault, p: NotePath): Promise<string> {
  throw new Error("unimplemented: core/vault/paths.resolveInVault");
}

/**
 * 에이전트 쓰기 대상인지 검사한다. `.md` 만 허용한다.
 *
 * 허용 루트는 `agentWriteRoot`(기본 wiki/) **와 `inbox/`** 둘이다 —
 * 상위 §4.1 이 "에이전트의 쓰기 대상은 wiki/·inbox/ 로 한정한다" 로 규정하고,
 * processInbox 가 편입 후 단편을 지우려면 inbox/ 쓰기가 필요하다.
 *
 * inbox/ 정리도 이 함수를 통과한다. 호출부가 우회하면
 * 상위 §9 가 "단일 방어 지점" 이라 부른 자리가 조용히 둘이 된다.
 */
export async function assertAgentWritable(v: Vault, p: NotePath): Promise<void> {
  throw new Error("unimplemented: core/vault/paths.assertAgentWritable");
}
