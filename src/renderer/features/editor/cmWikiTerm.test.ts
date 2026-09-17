import { describe, it, expect } from "vitest";
import { termDecoRanges } from "./cmWikiTerm.ts";
import { buildTermMatcher } from "./wikiTerms.ts";

const m = buildTermMatcher(["프로세스", "스레드"])!;

describe("termDecoRanges", () => {
  it("문서 좌표(offset)로 변환해 돌려준다", () => {
    expect(termDecoRanges("프로세스와 스레드", 100, m, [])).toEqual([
      { from: 100, to: 104, title: "프로세스" },
      { from: 106, to: 109, title: "스레드" },
    ]);
  });

  it("인라인 코드·임베드(텍스트 규칙)는 제외", () => {
    const text = "`프로세스` ![[프로세스.pdf]] 프로세스";
    const r = termDecoRanges(text, 0, m, []);
    expect(r).toEqual([{ from: text.length - 4, to: text.length, title: "프로세스" }]);
  });

  it("codeRanges(문서 좌표, syntaxTree 산출)와 겹치면 제외", () => {
    // offset 10, "프로세스" = 문서 10..14 — 코드 범위 12..20 과 겹침
    expect(termDecoRanges("프로세스", 10, m, [{ from: 12, to: 20 }])).toEqual([]);
  });
});
