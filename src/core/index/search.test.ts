// 쿼리 검색 — API 없이 확인한다.
import { describe, expect, it } from "vitest";
import { foldText, tokens } from "./search.ts";

describe("foldText", () => {
  it("공백을 지우지 않는다 — 로마자 단어 경계가 살아 있어야 한다", () => {
    expect(foldText("the OS is")).toBe("the os is");
  });
});

describe("tokens", () => {
  it("한글은 유니그램과 바이그램을 함께 낸다", () => {
    expect(tokens("잠들고")).toEqual(["잠", "들", "고", "잠들", "들고"]);
  });

  it("1글자 한글 질의어가 색인과 만난다 — 바이그램만이면 0건이 된다", () => {
    expect(tokens("잠")).toContain("잠");
    expect(tokens("잠들고")).toContain("잠");
  });

  it("로마자와 숫자는 낱말 통째로 둔다", () => {
    expect(tokens("DETR 5km")).toEqual(["detr", "5km"]);
  });
});

import { hash8, type WikiPage } from "../ingest/wiki.ts";
import { indexPages, search } from "./search.ts";

function page(name: string, summary: string, secs: [string, string][] = []): WikiPage {
  return {
    path: `wiki/${name}.md`,
    name,
    fm: { hashes: {} },
    summary,
    sections: secs.map(([heading, content]) => ({
      heading,
      content,
      ours: true,
      hash: hash8(content),
    })),
    records: [],
    recordsOurs: true,
  };
}

const VAULT = [
  page("무릎 통증", "달리기를 시작한 뒤 왼쪽 무릎 바깥쪽이 아프다. 쉬면 나아진다.", [
    ["증상", "5km 를 넘기면 달리기 중에 바깥쪽이 시큰거린다."],
  ]),
  page("달리기", "9월에 시작했다. 주 3회 5km 를 뛴다.", [["페이스", "킬로미터당 6분 정도다."]]),
  page("수면", "늦게 자는 편이다. 커피를 줄이면 나아진다.", [
    ["패턴", "새벽 2시에 잠들고 8시에 깬다."],
  ]),
];

describe("indexPages", () => {
  it("요약도 절로 담는다", () => {
    const ix = indexPages(VAULT);
    expect(ix.sections.filter((s) => s.heading === "요약")).toHaveLength(3);
  });

  it("절 6개를 담는다 — 페이지 3장 × (요약 + 본문 절 1)", () => {
    expect(indexPages(VAULT).sections).toHaveLength(6);
  });
});

describe("search", () => {
  it("본문에 이름이 없는 절도 페이지 이름으로 찾는다", () => {
    // `증상` 절 본문에는 "무릎" 이 없다. 색인 텍스트에 페이지 이름이 들어가야 통과한다.
    const hits = search(indexPages(VAULT), "무릎");
    expect(hits.some((h) => h.path === "wiki/무릎 통증.md" && h.heading === "증상")).toBe(true);
  });

  it("회귀: 1글자 낱말만 있는 질문도 찾는다", () => {
    const hits = search(indexPages(VAULT), "요즘 잠 잘 자?");
    expect(hits[0].path).toBe("wiki/수면.md");
  });

  it("이름이 달라도 본문 낱말로 찾는다", () => {
    const hits = search(indexPages(VAULT), "커피 줄였나?");
    expect(hits[0].path).toBe("wiki/수면.md");
  });

  it("한 페이지가 2절을 넘지 않는다", () => {
    const many = [
      page("달리기", "달리기 요약", [
        ["가", "달리기 달리기"],
        ["나", "달리기 달리기"],
        ["다", "달리기 달리기"],
      ]),
    ];
    expect(search(indexPages(many), "달리기")).toHaveLength(2);
  });

  it("겹치는 낱말이 없으면 0건이다", () => {
    // 한글 질의로는 이 경로를 결정론적으로 시험할 수 없다 — 유니그램이
    // 어떤 한 글자든 코퍼스와 우연히 겹친다. 로마자는 낱말 통째로 토큰이 된다.
    expect(search(indexPages(VAULT), "quantum")).toEqual([]);
  });

  it("발췌를 600자에서 자른다", () => {
    const long = [page("긴글", "요약", [["본문", "달리기 " + "가".repeat(900)]])];
    const hit = search(indexPages(long), "달리기").find((h) => h.heading === "본문");
    expect(hit!.text.length).toBeLessThanOrEqual(600);
  });
});
