// OWNER: A — 명명 충돌·중복 인제스트 규칙 미확정, 4단계에서 확정
import type { NotePath, Vault } from "../../shared/types.ts";

/** 원본을 sources/files/ 에, 추출 텍스트를 sources/text/ 에 보관한다. */
export async function storeSource(v: Vault, file: string, text: string): Promise<NotePath> {
  throw new Error("unimplemented: core/ingest/store.storeSource");
}
