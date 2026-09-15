// 검문·빌더의 보호 규칙 — API 없이 확인한다.
//
//   npx vitest run scripts/demo

import { describe, expect, it } from "vitest";
import { buildMarkdown, verify } from "./build.ts";
import { hash8, type WikiPage } from "./vault.ts";

function page(
  name: string,
  sections: { heading: string; content: string; ours: boolean }[],
): WikiPage {
  return {
    path: `wiki/${name}.md`,
    name,
    fm: { hashes: {} },
    summary: "",
    sections: sections.map((s) => ({ ...s, hash: hash8(s.content) })),
    records: [],
    recordsOurs: true,
  };
}

describe("잠긴 절", () => {
  it("사용자가 고친 절은 다시 쓰지 못하고, 우회한 절은 별개의 이름으로 들어간다", () => {
    const locked = "**(내가 직접 고침)** 주당 10% 규칙.";
    const existing = page("달리기", [{ heading: "훈련 원칙", content: locked, ours: false }]);
    const wiki = new Map([["달리기", existing]]);

    const out = verify({
      llmPages: [
        {
          name: "달리기",
          aliases_to_add: [],
          summary: null,
          new_sections: [],
          replace_sections: [{ target_heading: "훈련 원칙", content: "AI 가 다시 쓴 원칙." }],
          new_records: [],
        },
      ],
      sourceBody: "",
      names: { files: new Set(["달리기"]), aliases: new Map() },
      existing: wiki,
    });

    expect(out.issues.map((i) => i.kind)).toContain("절-잠김");
    expect(out.pages[0].replaces).toHaveLength(0);
    expect(out.pages[0].newSections[0].heading).toBe("훈련 원칙 (추가)");

    const md = buildMarkdown({
      page: out.pages[0],
      existing,
      sourceName: "2026-10-05",
      date: "2026-10-05",
      today: "2026-10-05",
    });

    // 사용자의 절은 글자 그대로, 지문 없이 남는다. AI 의 글은 따로 들어간다.
    expect(md).toContain(`## 훈련 원칙\n\n${locked}\n`);
    expect(md).toContain("## 훈련 원칙 (추가)\n\nAI 가 다시 쓴 원칙.");
    expect(md).not.toMatch(/^ {2}훈련 원칙: [0-9a-f]{8}$/m);
    expect(md).toMatch(/^ {2}훈련 원칙 \(추가\): [0-9a-f]{8}$/m);
  });

  it("빌더는 새 절이 잠긴 절과 같은 이름이어도 합치지 않는다", () => {
    const existing = page("달리기", [{ heading: "훈련 원칙", content: "사용자 글", ours: false }]);
    const md = buildMarkdown({
      page: {
        name: "달리기",
        aliasesToAdd: [],
        summary: null,
        newSections: [{ heading: "훈련 원칙", content: "AI 글" }],
        replaces: [],
        records: [],
      },
      existing,
      sourceName: "s",
      date: null,
      today: "2026-10-05",
    });
    expect(md).toContain("## 훈련 원칙\n\n사용자 글\n");
    expect(md).toContain("## 훈련 원칙 (추가)\n\nAI 글");
  });
});

describe("기록", () => {
  it("`기록`·`요약` 을 겨냥한 절은 버린다", () => {
    const out = verify({
      llmPages: [
        {
          name: "커피",
          aliases_to_add: [],
          summary: null,
          new_sections: [{ heading: "기록", content: "- 가짜" }],
          replace_sections: [{ target_heading: "요약", content: "가짜" }],
          new_records: [],
        },
      ],
      sourceBody: "",
      names: { files: new Set(), aliases: new Map() },
      existing: new Map(),
    });
    expect(out.issues.filter((i) => i.kind === "절-보호")).toHaveLength(2);
    expect(out.pages[0].newSections).toHaveLength(0);
    expect(out.pages[0].replaces).toHaveLength(0);
  });

  it("quote 는 원문에 있어야 하고, 12자 이상이면 끝 조사 하나는 봐준다", () => {
    const src = "스키마는 구조, 인스턴스는 실제 데이터\n\n키";
    const run = (quote: string) =>
      verify({
        llmPages: [
          {
            name: "관계형 모델",
            aliases_to_add: [],
            summary: null,
            new_sections: [],
            replace_sections: [],
            new_records: [{ fact: "f", quote }],
          },
        ],
        sourceBody: src,
        names: { files: new Set(), aliases: new Map() },
        existing: new Map(),
      }).pages[0].records.length;
    expect(run("스키마는 구조, 인스턴스는 실제 데이터는")).toBe(1);
    expect(run("스키마는 구조, 인스턴스는 가짜 데이터")).toBe(0);
    expect(run("데이터는")).toBe(0);
  });

  it("`나` 의 기록은 같은 호출의 다른 페이지에 같은 구절이 있으면 뺀다", () => {
    const src = "모두테크 서류 붙었다. 장조림 반 먹음.";
    const out = verify({
      llmPages: [
        {
          name: "나",
          aliases_to_add: [],
          summary: null,
          new_sections: [],
          replace_sections: [],
          new_records: [
            { fact: "서류 합격", quote: "모두테크 서류 붙었다" },
            { fact: "장조림 절반", quote: "장조림 반 먹음" },
          ],
        },
        {
          name: "모두테크",
          aliases_to_add: [],
          summary: "s",
          new_sections: [],
          replace_sections: [],
          new_records: [{ fact: "서류 전형 합격", quote: "모두테크 서류 붙었다" }],
        },
      ],
      sourceBody: src,
      names: { files: new Set(), aliases: new Map() },
      existing: new Map(),
    });
    const me = out.pages.find((p) => p.name === "나")!;
    expect(me.records.map((r) => r.fact)).toEqual(["장조림 절반"]);
  });
});

describe("기록 순서", () => {
  it("우리 글이면 날짜순으로 정렬하고 날짜 미상은 맨 뒤에 둔다", () => {
    const existing = {
      path: "wiki/DETR.md",
      name: "DETR",
      fm: { hashes: {} },
      summary: "",
      sections: [],
      records: ["- 2026-09-26 일기 ← [[a]]", "- (날짜 미상) 미상 ← [[b]]"],
      recordsOurs: true,
    };
    const md = buildMarkdown({
      page: {
        name: "DETR",
        aliasesToAdd: [],
        summary: null,
        newSections: [],
        replaces: [],
        records: [{ fact: "논문", quote: "q", anchor: "2페이지" }],
      },
      existing,
      sourceName: "@DETR (2020)",
      date: "2020-05-29",
      today: "2026-09-15",
    });
    const lines = md.split("\n").filter((l) => l.startsWith("- "));
    const head = (l: string) => (l.startsWith("- (날짜 미상)") ? "미상" : l.slice(2, 12));
    expect(lines.map(head)).toEqual(["2020-05-29", "2026-09-26", "미상"]);
  });
});

describe("자동 링크", () => {
  it("긴 이름을 감싼 뒤 그 안에서 짧은 이름을 또 감싸지 않는다", () => {
    const out = verify({
      llmPages: [
        {
          name: "가계부",
          aliases_to_add: [],
          summary: "s",
          new_sections: [{ heading: "10월", content: "부산 여행 22만원. 여행 뒤 헬스장 등록." }],
          replace_sections: [],
          new_records: [],
        },
      ],
      sourceBody: "",
      names: { files: new Set(["부산 여행", "여행", "헬스장"]), aliases: new Map() },
      existing: new Map([
        [
          "부산 여행",
          {
            path: "",
            name: "부산 여행",
            fm: {},
            summary: "",
            sections: [],
            records: [],
            recordsOurs: true,
          },
        ],
        [
          "여행",
          {
            path: "",
            name: "여행",
            fm: {},
            summary: "",
            sections: [],
            records: [],
            recordsOurs: true,
          },
        ],
        [
          "헬스장",
          {
            path: "",
            name: "헬스장",
            fm: {},
            summary: "",
            sections: [],
            records: [],
            recordsOurs: true,
          },
        ],
      ]),
    });
    expect(out.pages[0].newSections[0].content).toBe(
      "[[부산 여행]] 22만원. [[여행]] 뒤 [[헬스장]] 등록.",
    );
  });
});
