// OWNER: A — 스트리밍 계약 미확정, 4단계에서 확정
import type { LlmMessage } from "./gemini.ts";

export function generateStream(messages: LlmMessage[]): AsyncIterable<string> {
  throw new Error("unimplemented: core/llm/stream.generateStream");
}
