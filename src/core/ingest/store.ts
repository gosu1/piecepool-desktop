// OWNER: A — 명명 충돌·중복 인제스트 규칙 미확정, 4단계에서 확정.
// text: string 은 extractPdfText 의 페이지 배열을 평탄화한다. 상위 §6.1 이
// "에이전트가 위키 문장에 PDF 근거를 달 때 페이지 단위 인용이 필요하다" 고 했으므로,
// 평탄화된 문자열만 프롬프트에 들어가면 에이전트가 페이지 번호를 지어낸다. 4단계에서 정한다.
import type { NotePath, Vault } from "../../shared/types.ts";

/** 원본을 sources/files/ 에, 추출 텍스트를 sources/text/ 에 보관한다. */
export async function storeSource(v: Vault, file: string, text: string): Promise<NotePath> {
  throw new Error("unimplemented: core/ingest/store.storeSource");
}
