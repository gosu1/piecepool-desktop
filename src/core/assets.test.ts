import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { assetPath } from "./assets.ts";
import { loadPrompt } from "./prompts/load.ts";

describe("assetPath", () => {
  it("소스 트리의 자산을 실제로 읽는다", async () => {
    const text = await readFile(assetPath("prompts/write.md"), "utf8");
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("loadPrompt", () => {
  it("프롬프트 3종을 전부 읽는다", async () => {
    for (const name of ["write", "lint", "query"] as const) {
      expect((await loadPrompt(name)).length).toBeGreaterThan(0);
    }
  });
});
