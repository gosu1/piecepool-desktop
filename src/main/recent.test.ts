import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastVault, writeLastVault } from "./recent.ts";

async function tempState(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "pp-recent-")), "state.json");
}

describe("recent", () => {
  it("쓴 경로를 그대로 다시 읽는다", async () => {
    const f = await tempState();
    await writeLastVault(f, "C:/볼트/second-brain");
    expect(await readLastVault(f)).toBe("C:/볼트/second-brain");
  });

  it("파일이 없으면 null 이다", async () => {
    expect(await readLastVault(await tempState())).toBeNull();
  });

  it("내용이 깨졌으면 null 이다", async () => {
    const f = await tempState();
    await writeLastVault(f, "C:/볼트/x");
    await writeFile(f, "{ 이건 JSON 이 아니다", "utf8");
    expect(await readLastVault(f)).toBeNull();
  });

  it("부모 폴더가 없어도 쓴다", async () => {
    const f = join(await mkdtemp(join(tmpdir(), "pp-recent-")), "깊은", "곳", "state.json");
    await writeLastVault(f, "C:/볼트/y");
    expect(await readLastVault(f)).toBe("C:/볼트/y");
  });
});
