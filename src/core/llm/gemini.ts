// OWNER: A — 호출 형태·툴콜 프로토콜·재시도 미확정, 4단계에서 확정
export interface LlmMessage {
  role: "user" | "model";
  text: string;
}

export async function generate(messages: LlmMessage[]): Promise<string> {
  throw new Error("unimplemented: core/llm/gemini.generate");
}
