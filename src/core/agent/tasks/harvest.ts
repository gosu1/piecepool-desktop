// FROZEN: harvest() 진입점 (0단계 설계 §8)
import type { OnProgress, Vault } from "../../../shared/types.ts";
import type { IngestResult } from "./ingest.ts";
import type { QuerySession } from "./query.ts";

/**
 * 쿼리 세션을 하나의 자료로 보고 위키에 반영한다.
 * 사용자가 [위키에 반영] 을 누를 때만 일어난다 — 자동 반영하지 않는다.
 *
 * 쓰기 경로는 언제나 ingest 하나뿐이므로 여기서 ingest.run 을 재호출한다.
 * 세션 로그(.piecepool/sessions/<id>.md)는 툴이 아니라 여기서 쓰므로
 * ingest.run 의 extraPaths 로 넘겨 같은 커밋에 넣는다.
 */
export async function harvest(
  v: Vault,
  session: QuerySession,
  o?: { onProgress?: OnProgress },
): Promise<IngestResult> {
  throw new Error("unimplemented: core/agent/tasks/harvest.harvest");
}
