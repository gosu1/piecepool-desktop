import type { Vault } from "../../shared/types.ts";
import type { Written } from "./written.ts";

/** 상위 §7.2 가 이름과 인자를 문자 그대로 제시한 6종. */
export type ToolName =
  "list_notes" | "read_note" | "write_note" | "search" | "backlinks" | "delete_note";

/**
 * 쿼리 세션이 받는 집합. 쓰기 2종만 빠진다 —
 * 상위 §4.1 이 "읽기(read_note·search·backlinks)는 처음부터 볼트 전체를 본다" 고,
 * 상위 §7.2 가 "write_note / delete_note 는 vault/paths.ts 를 통과해야 한다" 고 규정한다.
 */
export type ReadOnlyToolName = Exclude<ToolName, "write_note" | "delete_note">;

export interface Tool {
  name: ToolName;
  run(args: Record<string, unknown>): Promise<unknown>;
}

// 4단계에 Tool 로 툴콜 스키마 같은 선택 필드가 추가되는 것은
// 동결 파기가 아니라 예정된 증분이다. 상위 문서에 툴콜 프로토콜이 없으므로
// 지금 schema 필드를 지어내면 거짓 안정성이 된다.
// args 는 LLM 이 준 신뢰할 수 없는 JSON 이라 런타임 검증을 거친다.

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
