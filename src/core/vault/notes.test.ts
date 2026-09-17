import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRaw } from "./notes.ts";
import type { Vault } from "../../shared/types.ts";

async function fixture(body: string): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-notes-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(join(root, "wiki", "a.md"), body, "utf8");
  return { root, agentWriteRoots: ["wiki"] };
}

describe("readRaw", () => {
  it("파일을 글자 그대로 돌려준다", async () => {
    const v = await fixture("---\ncreated: 2025-10-03\n---\n\n# 러닝\n");
    expect(await readRaw(v, "wiki/a.md")).toBe("---\ncreated: 2025-10-03\n---\n\n# 러닝\n");
  });

  it("볼트 밖 경로는 읽지 않는다", async () => {
    const v = await fixture("# a");
    await expect(readRaw(v, "../secret.md")).rejects.toMatchObject({ kind: "path_escape" });
  });

  it("없는 파일은 실패한다", async () => {
    const v = await fixture("# a");
    await expect(readRaw(v, "wiki/없다.md")).rejects.toThrow();
  });
});
