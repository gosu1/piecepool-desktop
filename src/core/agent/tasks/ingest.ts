import type { NotePath, OnProgress, Vault } from "../../../shared/types.ts";

/**
 * 인제스트의 입력. 볼트 밖 파일이거나 쿼리 세션 로그다.
 *
 * 이 유니온이 A(문서→wiki)와 B(wiki→query)의 경계면이다.
 * 파일 경로만 받으면 수확이 대화 로그를 넘길 방법이 없다.
 * 수확은 전용 프롬프트를 두지 않고 ingest 프롬프트를 그대로 쓴다 —
 * 출처가 세션이라는 사실만 여기서 넘어와 각주가 붙는다.
 */
export type IngestSource =
  | { kind: "file"; path: string }
  | { kind: "session"; id: string; log: string };

export interface IngestResult {
  /** 이번 작업이 쓴 경로. 커밋 대상이다. */
  written: NotePath[];
  commitOid: string;
}

export async function run(
  v: Vault,
  src: IngestSource,
  o?: { onProgress?: OnProgress },
): Promise<IngestResult> {
  throw new Error("unimplemented: core/agent/tasks/ingest.run");
}
