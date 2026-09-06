// OWNER: A — 종료 조건·최대 반복·중단(cancel) 미확정, 4단계에서 확정
import type { OnProgress } from "../../shared/types.ts";
import type { Tool } from "./tools.ts";

export async function runAgent(
  prompt: string,
  input: string,
  tools: Tool[],
  o?: { onProgress?: OnProgress },
): Promise<string> {
  throw new Error("unimplemented: core/agent/loop.runAgent");
}
