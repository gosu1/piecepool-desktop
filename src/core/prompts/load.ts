import { readFile } from "node:fs/promises";
import { assetPath } from "../assets.ts";

export type PromptName = "write" | "lint" | "query";

/**
 * 프롬프트는 3종이다.
 *
 * `write` 하나가 볼트 밖 파일(`ingest`)과 볼트 안 노트(정리하기)를 모두 맡는다.
 * 전처리를 거치면 둘 다 `<context>` 태그로 감싼 텍스트가 되므로 프롬프트가
 * 입력 출처를 알 필요가 없다. 수확(대화 로그)도 같은 프롬프트를 쓴다.
 * 근거는 ADR-0002 결정 2.
 */
export async function loadPrompt(name: PromptName): Promise<string> {
  return readFile(assetPath(`prompts/${name}.md`), "utf8");
}
