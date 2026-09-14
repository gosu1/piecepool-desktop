import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTree } from "./tree.ts";
import type { Vault } from "../../shared/types.ts";

/** 픽스처 볼트를 만든다. dirs 는 폴더, files 는 빈 파일이다. */
async function fixture(dirs: string[], files: string[]): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-tree-"));
  for (const d of dirs) await mkdir(join(root, d), { recursive: true });
  for (const f of files) await writeFile(join(root, f), "", "utf8");
  return { root, agentWriteRoot: "wiki" };
}

describe("readTree", () => {
  it("점으로 시작하는 폴더를 건너뛴다", async () => {
    const v = await fixture([".git", ".obsidian", "wiki"], [".git/HEAD"]);
    expect((await readTree(v)).map((n) => n.name)).toEqual(["wiki"]);
  });

  it("마크다운이 아닌 파일을 제외한다", async () => {
    const v = await fixture([], ["a.md", "b.pdf", "c.png"]);
    expect((await readTree(v)).map((n) => n.name)).toEqual(["a.md"]);
  });

  it("폴더를 파일보다 먼저 두고 각각 이름순으로 정렬한다", async () => {
    const v = await fixture(["zeta", "alpha"], ["z.md", "a.md"]);
    expect((await readTree(v)).map((n) => n.name)).toEqual(["alpha", "zeta", "a.md", "z.md"]);
  });

  it("중첩 폴더를 children 으로 담고 경로는 POSIX 구분자를 쓴다", async () => {
    const v = await fixture(["wiki/개념"], ["wiki/개념/트랜스포머.md"]);
    const tree = await readTree(v);
    const nested = tree[0].children?.[0].children?.[0];
    expect(nested?.path).toBe("wiki/개념/트랜스포머.md");
    expect(nested?.kind).toBe("file");
  });

  it("빈 폴더도 결과에 남긴다", async () => {
    const v = await fixture(["빈폴더"], []);
    const tree = await readTree(v);
    expect(tree.map((n) => n.name)).toEqual(["빈폴더"]);
    expect(tree[0].children).toEqual([]);
  });

  it("심볼릭 링크 폴더를 따라가지 않는다", async () => {
    const v = await fixture(["진짜"], ["진짜/x.md"]);
    try {
      await symlink(join(v.root, "진짜"), join(v.root, "링크"), "dir");
    } catch {
      // Windows 는 개발자 모드나 관리자 권한이 없으면 링크를 못 만든다.
      return;
    }
    expect((await readTree(v)).map((n) => n.name)).toEqual(["진짜"]);
  });
});
