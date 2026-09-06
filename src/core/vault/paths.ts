import type { NotePath, Vault } from "../../shared/types.ts";

/**
 * 볼트 밖 경로 탈출을 막는 단일 방어 지점이다.
 * resolve 후 루트 접두사 검사 + realpath 로 심볼릭 링크 우회까지 차단한다.
 * 경로 검증을 여기 말고 다른 곳에 두지 않는다.
 */
export async function resolveInVault(v: Vault, p: NotePath): Promise<string> {
  throw new Error("unimplemented: core/vault/paths.resolveInVault");
}

/** 에이전트 쓰기 대상인지 검사한다. .md 만, agentWriteRoot 아래만 허용한다. */
export async function assertAgentWritable(v: Vault, p: NotePath): Promise<void> {
  throw new Error("unimplemented: core/vault/paths.assertAgentWritable");
}
