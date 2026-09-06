// OWNER: A — 사용자 왕복 상호작용의 형태(콜백 vs 계획 반환 후 적용) 미확정.
// 7단계 IPC 설계에 걸려 있으므로 3단계에서 확정한다.
import type { NotePath, Vault } from "../../shared/types.ts";

/**
 * 되돌리기. 자동 병합을 시도하지 않고 경로별로 복원한다.
 * 커밋 이후 사용자가 고친 파일은 목록으로 보여주고 사용자가 고르게 한다.
 * 부분 복원 결과는 그 자체가 새 커밋이 된다 — 이력을 다시 쓰지 않는다.
 */
export async function restorePaths(
  v: Vault,
  commitOid: string,
  paths: NotePath[],
): Promise<void> {
  throw new Error("unimplemented: core/git/restore.restorePaths");
}
