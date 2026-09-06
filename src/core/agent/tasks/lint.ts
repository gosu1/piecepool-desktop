// OWNER: A — 리포트 구조 미확정, 5단계에서 확정.
// 상위 §7.3 이 "수정 시 1개" 커밋이므로 반환에 commitOid 가 붙는다.
import type { NotePath, OnProgress, Vault } from "../../../shared/types.ts";

export interface LintFinding {
  kind: "broken_link" | "orphan" | "duplicate" | "contradiction" | "unverified";
  path: NotePath;
  detail: string;
}

/**
 * 검증은 게이트가 아니라 관찰이다. 저장을 막지 않는다 —
 * 사용자가 옵시디언으로 직접 고친 파일도 똑같이 유효해야 하므로.
 * 깨진 링크는 에러가 아니라 할 일 목록의 한 줄이다.
 *
 * unverified: 출처가 대화뿐인 문단. 자동으로 지우지 않고 보고만 한다.
 */
export async function run(v: Vault, o?: { onProgress?: OnProgress }): Promise<LintFinding[]> {
  throw new Error("unimplemented: core/agent/tasks/lint.run");
}
