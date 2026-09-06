import type { Vault } from "../../shared/types.ts";
import type { Written } from "./written.ts";

export interface Tool {
  name: string;
  run(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * 툴 6종: list_notes · read_note · write_note · search · backlinks · delete_note
 *
 * 읽기는 볼트 전체를 본다. 쓰기는 agentWriteRoot 아래 .md 만 —
 * 즉 에이전트는 볼트 전체를 근거로 삼되 정해진 곳에만 쓴다.
 * sources/files/ 는 쓰기 금지다.
 *
 * readOnly 는 쿼리 세션용이다. 대화 중에는 위키를 고치지 않고,
 * 반영은 세션 끝의 수확에서 ingest 를 통해 일어난다.
 */
export function createTools(v: Vault, w: Written, o?: { readOnly?: boolean }): Tool[] {
  throw new Error("unimplemented: core/agent/tools.createTools");
}
