import { readFile } from "node:fs/promises";
import { assetPath } from "../assets.ts";

export type PromptName = "ingest" | "inbox" | "lint" | "query";

/** 프롬프트는 4종뿐이다. 수확은 ingest 프롬프트를 그대로 쓴다. */
export async function loadPrompt(name: PromptName): Promise<string> {
  return readFile(assetPath(`prompts/${name}.md`), "utf8");
}
