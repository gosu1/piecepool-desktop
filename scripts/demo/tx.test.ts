// 트랜잭션·출처 페이지·별칭 해석 — API 없이 확인한다.

import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commitFiles } from "./tx.ts";
import { buildSourcePage } from "./source.ts";
import { verify } from "./build.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "piecepool-tx-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("트랜잭션", () => {
  it("여러 파일을 쓰고 .bak·.tmp 를 남기지 않는다", async () => {
    await writeFile(join(dir, "a.md"), "old a", "utf8");
    await commitFiles([
      { path: join(dir, "a.md"), content: "new a", mustExist: true },
      { path: join(dir, "sub", "b.md"), content: "new b" },
    ]);
    expect(await readFile(join(dir, "a.md"), "utf8")).toBe("new a");
    expect(await readFile(join(dir, "sub", "b.md"), "utf8")).toBe("new b");
    expect((await readdir(dir)).sort()).toEqual(["a.md", "sub"]);
  });

  it("갱신 대상이 사라졌으면 아무것도 쓰지 않는다", async () => {
    await expect(
      commitFiles([
        { path: join(dir, "new.md"), content: "x" },
        { path: join(dir, "gone.md"), content: "y", mustExist: true },
      ]),
    ).rejects.toThrow("사라졌습니다");
    expect(await readdir(dir)).toEqual([]);
  });

  it("중간에 실패하면 이미 바꾼 파일을 되돌린다", async () => {
    await writeFile(join(dir, "a.md"), "old a", "utf8");
    // 두 번째 대상을 디렉터리로 만들어 rename 이 실패하게 한다.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(dir, "b.md"));
    await expect(
      commitFiles([
        { path: join(dir, "a.md"), content: "new a", mustExist: true },
        { path: join(dir, "b.md"), content: "new b" },
      ]),
    ).rejects.toThrow("되돌렸습니다");
    expect(await readFile(join(dir, "a.md"), "utf8")).toBe("old a");
    expect((await readdir(dir)).sort()).toEqual(["a.md", "b.md"]);
  });
});

describe("출처 페이지", () => {
  it("PDF 는 페이지 헤딩으로 나뉘고 프론트매터는 5필드다", () => {
    const md = buildSourcePage({
      src: { path: "sources/DETR (2020).pdf", name: "DETR (2020)" },
      rawHash: "0123abcd",
      date: "2020-05-29",
      today: "2026-09-15",
      extracted: { pages: ["첫 쪽", "둘째 쪽"], metaDate: "2020-05-29" },
    });
    expect(md).toContain(
      'type: source\nraw: "[[sources/DETR (2020).pdf]]"\nraw_hash: 0123abcd\ndate: 2020-05-29\ncreated: 2026-09-15',
    );
    expect(md).toContain(
      "# DETR (2020)\n\n![[sources/DETR (2020).pdf]]\n\n## 1페이지\n\n첫 쪽\n\n## 2페이지\n\n둘째 쪽",
    );
    expect(md).not.toContain("hashes:");
  });
});

describe("별칭 해석", () => {
  const page = (name: string, aliases: string[]) => ({
    path: `wiki/${name}.md`,
    name,
    fm: { aliases, hashes: {} },
    summary: "",
    sections: [],
    records: [],
    recordsOurs: true,
  });
  const run = (content: string, aliasesToAdd: string[] = []) =>
    verify({
      llmPages: [
        {
          name: "새 페이지",
          aliases_to_add: aliasesToAdd,
          summary: "s",
          new_sections: [{ heading: "절", content }],
          replace_sections: [],
          new_records: [],
        },
      ],
      sourceBody: "",
      names: {
        files: new Set(["러너스 니", "김 대리"]),
        aliases: new Map([
          ["장경인대 증후군", ["러너스 니"]],
          ["김대리", ["김 대리", "김대리 (영업)"]],
        ]),
      },
      existing: new Map([
        ["러너스 니", page("러너스 니", ["장경인대 증후군"])],
        ["김 대리", page("김 대리", ["김대리"])],
      ]),
    });

  it("파일명은 그대로, 단일 별칭도 그대로, 두 페이지에 걸린 별칭은 해제한다", () => {
    const out = run("[[러너스 니]] [[장경인대 증후군]] [[김대리]] [[없는 것]]");
    expect(out.pages[0].newSections[0].content).toBe(
      "[[러너스 니]] [[장경인대 증후군]] 김대리 없는 것",
    );
    expect(out.issues.map((i) => i.detail)).toEqual([
      "[[김대리]] — 별칭이 두 페이지에 걸립니다",
      "[[없는 것]] — 목록에 없습니다",
    ]);
  });

  it("다른 페이지의 이름이나 별칭은 별칭으로 넣지 못한다", () => {
    const out = run("x", ["러너스 니", "장경인대 증후군", "새 별칭"]);
    expect(out.pages[0].aliasesToAdd).toEqual(["새 별칭"]);
    expect(out.issues.filter((i) => i.kind === "별칭-차단")).toHaveLength(2);
  });
});

describe("세션 로그", () => {
  it("AI 턴에서 찾은 quote 는 기록 줄에 (AI) 가 붙고, 사용자 턴은 붙지 않는다", async () => {
    const { buildMarkdown } = await import("./build.ts");
    const log =
      "## 1턴 (사용자)\n\n좌석마다 슬롯을 두는 식으로 쓸 수 있을까?\n\n## 2턴 (AI)\n\nquery 하나하나가 특정 위치와 크기 영역을 담당하는 경향이 있습니다.";
    const out = verify({
      llmPages: [
        {
          name: "DETR",
          aliases_to_add: [],
          summary: "s",
          new_sections: [],
          replace_sections: [],
          new_records: [
            {
              fact: "query 는 특정 위치·크기 영역을 담당한다",
              quote: "query 하나하나가 특정 위치와 크기 영역을 담당하는 경향이 있습니다",
            },
            { fact: "좌석마다 슬롯을 두는 발상", quote: "좌석마다 슬롯을 두는 식으로" },
          ],
        },
      ],
      sourceBody: log,
      names: { files: new Set(), aliases: new Map() },
      existing: new Map(),
    });
    const md = buildMarkdown({
      page: out.pages[0],
      existing: undefined,
      sourceName: "@session-2026-09-15-2130",
      date: "2026-09-15",
      today: "2026-09-15",
    });
    expect(md).toContain("← [[@session-2026-09-15-2130#2턴 (AI)]] (AI)");
    expect(md).toContain("← [[@session-2026-09-15-2130#1턴 (사용자)]]\n");
    expect(md).not.toContain("(사용자)]] (AI)");
  });
});
