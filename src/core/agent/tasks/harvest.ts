// FROZEN: harvest() 진입점 (0단계 설계 §8)
import type { OnProgress, Vault } from "../../../shared/types.ts";
import { PiecePoolError } from "../../errors.ts";
import type { EngineOptions } from "../../ingest/engine.ts";
import { ingestSource } from "../../ingest/sync.ts";
import type { IngestResult } from "./ingest.ts";
import type { QuerySession } from "./query.ts";

/**
 * 쿼리 세션을 하나의 자료로 보고 위키에 반영한다.
 * 사용자가 [위키에 반영] 을 누를 때만 일어난다 — 자동 반영하지 않는다.
 *
 * 쓰기 경로는 언제나 ingest 하나뿐이므로 여기서 ingest 를 재호출한다.
 * 세션 로그(.piecepool/sessions/<id>.md)는 툴이 아니라 ask() 가 쓰므로
 * extraPaths 로 넘겨 같은 커밋에 넣는다.
 */
export async function harvest(
  v: Vault,
  session: QuerySession,
  o?: { onProgress?: OnProgress },
): Promise<IngestResult> {
  if (!session.log) throw new PiecePoolError("parse_failed", "반영할 대화가 없다");
  return await harvestLog(v, session.id, session.log, o);
}

/**
 * harvest() 의 본체. 진입점은 동결이라 테스트용 가짜 AI(`llm`)를 받을 자리가 없어
 * 여기로 뺐다 — `ingest/sync.ts` 의 `ingestSource` 와 같은 이유다.
 * `npm run harvest` 도 파일에서 읽은 로그로 이것을 직접 부른다.
 */
export async function harvestLog(
  v: Vault,
  id: string,
  log: string,
  o: EngineOptions = {},
): Promise<IngestResult> {
  return await ingestSource(
    v,
    { kind: "session", id, log },
    { ...o, extraPaths: [`.piecepool/sessions/${id}.md`] },
  );
}
