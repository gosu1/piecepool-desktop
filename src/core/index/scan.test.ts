import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanVault, titleOf, toGraph } from "./scan.ts";
import type { Vault } from "../../shared/types.ts";

/** 픽스처 볼트. files 는 `상대경로 → 내용` 이다. */
async function fixture(files: Record<string, string>): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-scan-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body, "utf8");
  }
  return { root, agentWriteRoots: ["wiki"] };
}

describe("titleOf", () => {
  it("폴더를 떼고 .md 를 뗀다", () => {
    expect(titleOf("wiki/개념/트랜스포머.md")).toBe("트랜스포머");
  });

  it("확장자 대소문자를 가리지 않는다", () => {
    expect(titleOf("README.MD")).toBe("README");
  });
});

describe("scanVault", () => {
  it("모든 .md 를 targets 에 담는다", async () => {
    const v = await fixture({ "wiki/CNN.md": "", "inbox/메모.md": "" });
    const ix = await scanVault(v);
    expect([...ix.targets.files].sort()).toEqual(["inbox/메모.md", "wiki/CNN.md"]);
  });

  it("숨김 폴더의 .md 는 담지 않는다", async () => {
    const v = await fixture({ "wiki/CNN.md": "", ".piecepool/sessions/s.md": "" });
    const ix = await scanVault(v);
    expect([...ix.targets.files]).toEqual(["wiki/CNN.md"]);
  });

  it("링크를 해석해 resolved 를 채운다", async () => {
    const v = await fixture({ "wiki/A.md": "[[B]] 와 [[없는것]]", "wiki/B.md": "" });
    const ix = await scanVault(v);
    expect(ix.links.map((l) => [l.to, l.resolved])).toEqual([
      ["B", "wiki/B.md"],
      ["없는것", null],
    ]);
  });

  it("동명 노트는 먼저 들어온 것이 이긴다", async () => {
    const v = await fixture({ "wiki/A.md": "", "inbox/A.md": "", "wiki/z.md": "[[A]]" });
    const ix = await scanVault(v);
    // readTree 는 폴더를 이름순으로 내므로 inbox/ 가 wiki/ 보다 먼저다.
    expect(ix.links[0].resolved).toBe("inbox/A.md");
  });
});

describe("toGraph", () => {
  it("노드 수가 볼트의 .md 수와 같다 — 링크가 없어도 남는다", async () => {
    const v = await fixture({ "wiki/A.md": "", "wiki/B.md": "", "wiki/고아.md": "" });
    const g = toGraph(await scanVault(v));
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["wiki/A.md", "wiki/B.md", "wiki/고아.md"]);
    expect(g.edges).toEqual([]);
  });

  it("노드 title 은 파일명에서 .md 를 뗀 것이다", async () => {
    const v = await fixture({ "wiki/개념/트랜스포머.md": "" });
    const g = toGraph(await scanVault(v));
    expect(g.nodes[0]).toEqual({ id: "wiki/개념/트랜스포머.md", title: "트랜스포머" });
  });

  it("깨진 링크는 엣지가 되지 않는다", async () => {
    const v = await fixture({ "wiki/A.md": "[[없는것]]" });
    expect(toGraph(await scanVault(v)).edges).toEqual([]);
  });

  it("자기 자신 링크는 엣지가 되지 않는다", async () => {
    const v = await fixture({ "wiki/A.md": "[[A]]" });
    expect(toGraph(await scanVault(v)).edges).toEqual([]);
  });

  it("A→B 와 B→A 를 엣지 하나로 접는다", async () => {
    const v = await fixture({ "wiki/A.md": "[[B]]", "wiki/B.md": "[[A]]" });
    expect(toGraph(await scanVault(v)).edges).toEqual([
      { source: "wiki/A.md", target: "wiki/B.md" },
    ]);
  });

  it("같은 대상을 여러 번 링크해도 엣지 하나다", async () => {
    const v = await fixture({ "wiki/A.md": "[[B]] 그리고 또 [[B]]", "wiki/B.md": "" });
    expect(toGraph(await scanVault(v)).edges).toHaveLength(1);
  });

  it("임베드도 엣지가 된다 — 관계에 타입이 없다", async () => {
    const v = await fixture({ "wiki/A.md": "![[B]]", "wiki/B.md": "" });
    expect(toGraph(await scanVault(v)).edges).toEqual([
      { source: "wiki/A.md", target: "wiki/B.md" },
    ]);
  });
});
