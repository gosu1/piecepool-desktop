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

  it("원문의 마크다운 강조 표시는 quote 대조에서 무시한다", () => {
    const src = "- 환각 비율: 23.5% → **14.0%**\n- _속도_ 5배";
    const run = (quote: string) =>
      verify({
        llmPages: [
          {
            name: "exp-007",
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
    expect(run("환각 비율: 23.5% → 14.0%")).toBe(1);
    expect(run("속도 5배")).toBe(1);
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

describe("나 허브", () => {
  it("링크 집합이 같은 절은 뒤에 생긴 쪽을 버리고, 부분집합은 둔다", () => {
    const md = buildMarkdown({
      page: {
        name: "나",
        aliasesToAdd: [],
        summary: null,
        newSections: [
          { heading: "공유", content: "[[CNN]] · [[DETR]]" },
          { heading: "여행", content: "[[부산 여행]]" },
        ],
        replaces: [],
        records: [],
      },
      existing: {
        path: "wiki/나.md",
        name: "나",
        fm: { hashes: {} },
        summary: "",
        sections: [{ heading: "공부", content: "[[DETR]] · [[CNN]]", hash: "", ours: true }],
        records: [],
        recordsOurs: true,
      },
      sourceName: "s",
      date: null,
      today: "2026-09-15",
    });
    // 공유 == 공부 (순서만 다름) → 버림. 여행 ⊂ 공부 → 남김
    expect(md).not.toContain("## 공유");
    expect(md).toContain("## 여행\n\n[[부산 여행]]");
    expect(md).toContain("## 공부\n\n[[DETR]] · [[CNN]]");
  });
});

describe("이름 정리", () => {
  it("파일에 못 쓰는 글자를 뗀 이름으로 링크까지 고친다", () => {
    const out = verify({
      llmPages: [
        {
          name: "Numbers Lie First: Numeric",
          aliases_to_add: [],
          summary: "s",
          new_sections: [],
          replace_sections: [],
          new_records: [],
        },
        {
          name: "환각",
          aliases_to_add: [],
          summary: "s",
          new_sections: [
            { heading: "논문", content: "제목은 [[Numbers Lie First: Numeric|초안]] 이다." },
          ],
          replace_sections: [],
          new_records: [],
        },
      ],
      sourceBody: "",
      names: { files: new Set(), aliases: new Map() },
      existing: new Map(),
    });
    expect(out.pages[0].name).toBe("Numbers Lie First Numeric");
    expect(out.pages[1].newSections[0].content).toBe(
      "제목은 [[Numbers Lie First Numeric|초안]] 이다.",
    );
    expect(out.issues.filter((i) => i.kind === "링크-해제")).toHaveLength(0);
  });
});

describe("깨진 낱말 되돌리기 (2026-09-17)", () => {
  const src = "# 면담\n\n졸업: 내년 6월. 해법을 찾는다. 아무도 안 잰 것 같다.";
  const run = (page: Partial<Parameters<typeof verify>[0]["llmPages"][0]>) =>
    verify({
      llmPages: [
        {
          name: "졸업",
          aliases_to_add: [],
          summary: null,
          new_sections: [],
          replace_sections: [],
          new_records: [],
          ...page,
        },
      ],
      sourceBody: src,
      names: { files: new Set(), aliases: new Map() },
      existing: new Map(),
      // 사전 대역 — 깨진 꼴만 "낱말 아님". 본문·사실은 사전이 있어야 되돌린다.
      isWord: (w) => !/^(낸년|핵법|아묘도)/.test(w),
    });

  it("quote 의 받침 오타는 원문으로 되돌려 통과시키고 기록 줄은 원문 글자를 쓴다", () => {
    const out = run({ new_records: [{ fact: "졸업은 낸년 6월이다", quote: "졸업: 낸년 6월" }] });
    expect(out.pages[0].records).toHaveLength(1);
    expect(out.pages[0].records[0].fact).toBe("졸업은 내년 6월이다");
    expect(out.issues.filter((i) => i.kind === "오타-되돌림")).toHaveLength(2);
  });

  it("절 본문의 오타도 되돌린다", () => {
    const out = run({
      new_sections: [{ heading: "계획", content: "핵법을 찾는 중이고 아묘도 모른다." }],
    });
    expect(out.pages[0].newSections[0].content).toBe("해법을 찾는 중이고 아무도 모른다.");
  });
});

describe("인용 찾기 범위와 앵커 (2026-09-17)", () => {
  const src =
    "## 1페이지\n\nwe use probabil-\n\n## 2페이지\n\nities instead of log-probabilities here.\n\n## **총평**\n\n정말 좋았다고 생각한다.";
  const run = (quote: string) =>
    verify({
      llmPages: [
        {
          name: "DETR",
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
    }).pages[0].records;

  it("쪽 경계에 걸친 인용은 문서 전체에서 찾고 시작 쪽을 앵커로 쓴다", () => {
    const r = run("we use probabilities instead of log-probabilities");
    expect(r).toHaveLength(1);
    expect(r[0].anchor).toBe("1페이지");
  });

  it("헤딩의 강조 표시는 앵커에서 뺀다", () => {
    expect(run("정말 좋았다고 생각한다")[0].anchor).toBe("총평");
  });
});

describe("반복 링크와 기록 중복 (2026-09-17)", () => {
  it("한 절 안에서 같은 이름은 첫 등장만 링크로 남긴다", () => {
    const out = verify({
      llmPages: [
        {
          name: "exp-007",
          aliases_to_add: [],
          summary: null,
          new_sections: [
            {
              heading: "결과",
              content: "[[환각]] 비율이 줄었다. 숫자 [[환각]]은 9개. [[환각]] 14%.",
            },
          ],
          replace_sections: [],
          new_records: [],
        },
      ],
      sourceBody: "환각 비율이 줄었다",
      names: { files: new Set(["환각"]), aliases: new Map() },
      existing: new Map(),
    });
    expect(out.pages[0].newSections[0].content).toBe(
      "[[환각]] 비율이 줄었다. 숫자 환각은 9개. 환각 14%.",
    );
  });

  it("이미 있는 기록과 같은 사실은 다시 넣지 않는다", () => {
    const existing = new Map<string, WikiPage>([
      [
        "세마포어",
        {
          ...page("세마포어", []),
          records: ["- 2026-05-31 세마포어는 정수 변수 S 하나에 두 연산만 가능하다 ← [[x]]"],
        },
      ],
    ]);
    const out = verify({
      llmPages: [
        {
          name: "세마포어",
          aliases_to_add: [],
          summary: null,
          new_sections: [],
          replace_sections: [],
          new_records: [
            {
              fact: "세마포어는 정수 변수 S 하나에 두 연산만 가능하다",
              quote: "정수 변수 S 하나에",
            },
            { fact: "wait 은 값을 줄인다", quote: "wait 은 값을 줄인다" },
          ],
        },
      ],
      sourceBody: "세마포어는 정수 변수 S 하나에 두 연산만 가능하다. wait 은 값을 줄인다.",
      names: { files: new Set(["세마포어"]), aliases: new Map() },
      existing,
    });
    expect(out.pages[0].records.map((r) => r.fact)).toEqual(["wait 은 값을 줄인다"]);
    expect(out.issues.filter((i) => i.kind === "기록-중복")).toHaveLength(1);
  });
});
