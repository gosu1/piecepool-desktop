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
  { kind: "file"; path: string } | { kind: "session"; id: string; log: string };

export interface IngestResult {
  /**
   * 이 커밋에 들어간 전체 경로 = 툴이 쓴 것 U extraPaths.
   *
   * 되돌리기(git/restore.restorePaths)가 이 목록을 그대로 받는다.
   * 툴이 쓴 것만 담으면 수확 커밋을 되돌려도 세션 로그가 남는다 —
   * 커밋 단위와 경로 집합이 어긋나는 형태다.
   */
  written: NotePath[];
  commitOid: string;
}

export async function run(
  v: Vault,
  src: IngestSource,
  o?: {
    onProgress?: OnProgress;
    /**
     * 툴이 아니라 호출부가 쓴 파일. 커밋 경로에 함께 넣는다.
     * 수확이 .piecepool/sessions/<id>.md 를 여기로 넘긴다 —
     * 이게 없으면 세션 로그가 두 번째 커밋으로 밀려 "커밋 1개" 가 깨진다.
     */
    extraPaths?: NotePath[];
  },
): Promise<IngestResult> {
  throw new Error("unimplemented: core/agent/tasks/ingest.run");
}
