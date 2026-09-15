// FROZEN: 파일 전체 (0단계 설계 §8, 상위 §7.1)
import type { OnProgress } from "../../shared/types.ts";

/**
 * pdfjs-dist 의 legacy 빌드를 순수 Node 에서 단독 추출기로 쓴다.
 * 기본 빌드는 브라우저 전용 API 를 전제하므로 Node 에서 돌지 않는다.
 *
 * CMap 자산을 함께 번들하고 cMapUrl/cMapPacked 를 지정해야 한다 —
 * 한글 CID PDF(UniKS-UTF16-H 등)가 여기 달려 있고, 빠뜨리면
 * 실측 14개 중 2개가 실패하던 상태로 돌아간다. 경로는 core/assets.assetPath 를 쓴다.
 *
 * page 는 1-indexed, 빈 페이지는 "" 로 보존한다 — ![[x.pdf#page=N]] 이 여기 의존한다.
 * 텍스트가 0자면 스캔본·손글씨로 보고 parse_failed 로 알린다. OCR 은 범위 밖이다.
 */
export async function extractPdfText(
  file: string,
  o?: { onProgress?: OnProgress },
): Promise<string[]> {
  throw new Error("unimplemented: core/ingest/pdf.extractPdfText");
}
