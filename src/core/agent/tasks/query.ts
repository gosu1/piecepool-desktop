// FROZEN: ask() 진입점만 동결. QuerySession 은 가배치 (0단계 설계 §8)
// OWNER: B — 세션 로그 스키마 미확정, 6단계에서 확정
import type { OnProgress, Vault } from "../../../shared/types.ts";

export interface QuerySession {
  id: string;
  log: string;
}

/** 위키를 근거로 답한다. 읽기 전용 툴만 받는다 — 대화 중에는 위키를 고치지 않는다. */
export async function ask(
  v: Vault,
  session: QuerySession,
  question: string,
  o?: { onProgress?: OnProgress },
): Promise<string> {
  throw new Error("unimplemented: core/agent/tasks/query.ask");
}
