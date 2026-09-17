// 근거 대조 — 연 절을 가리키는 링크만 남긴다.
import { describe, expect, it } from "vitest";
import { checkCitations } from "./cite.ts";

// 이름 → 경로. 실제로는 index/links.ts 의 resolveLink 가 한다.
const resolve = (name: string) =>
  ({ "무릎 통증": "wiki/무릎 통증.md", 달리기: "wiki/달리기.md" })[name] ?? null;

const opened = new Set(["wiki/무릎 통증.md#증상", "wiki/달리기.md"]);

describe("checkCitations", () => {
  it("연 절을 가리키는 링크는 그대로 둔다", () => {
    const r = checkCitations("아프다. [[무릎 통증#증상]]", opened, resolve);
    expect(r.text).toBe("아프다. [[무릎 통증#증상]]");
    expect(r.dropped).toEqual([]);
  });

  it("페이지 전문을 열었으면 그 페이지의 어느 절이든 통과한다", () => {
    const r = checkCitations("주 3회 뛴다. [[달리기#페이스]]", opened, resolve);
    expect(r.dropped).toEqual([]);
  });

  it("연 적 없는 절의 링크는 뗀다 — 글자는 남긴다", () => {
    const r = checkCitations("졸리다. [[무릎 통증#재활]]", opened, resolve);
    expect(r.text).toBe("졸리다. 무릎 통증#재활");
    expect(r.dropped).toEqual(["무릎 통증#재활"]);
  });

  it("볼트에 없는 페이지의 링크도 뗀다", () => {
    const r = checkCitations("음. [[없는페이지]]", opened, resolve);
    expect(r.text).toBe("음. 없는페이지");
    expect(r.dropped).toEqual(["없는페이지"]);
  });

  it("링크 없는 문단을 unsourced 로 센다", () => {
    const r = checkCitations("첫 문단.\n\n둘째 문단. [[달리기]]\n\n셋째 문단.", opened, resolve);
    expect(r.unsourced).toBe(2);
  });

  it("표시 텍스트가 있는 링크도 읽는다", () => {
    const r = checkCitations("여기. [[무릎 통증#증상|무릎]]", opened, resolve);
    expect(r.dropped).toEqual([]);
  });

  it("이름이 빈 링크는 검증도 집계도 통과시키지 않는다", () => {
    const r = checkCitations("이건 사실무근이다. [[#가짜]]", opened, resolve);
    expect(r.dropped).toEqual([]);
    expect(r.unsourced).toBe(1);
  });

  it("인라인 코드 안의 [[...]] 는 근거로 안 친다", () => {
    const answer = "근거는 `[[페이지#절]]` 형식으로 답니다.";
    const r = checkCitations(answer, opened, resolve);
    expect(r.text).toBe(answer);
    expect(r.dropped).toEqual([]);
    expect(r.unsourced).toBe(1);
  });

  it("코드 블록 안의 [[...]] 도 근거로 안 치고, 블록 내용은 훼손되지 않는다", () => {
    const answer = "설명.\n\n```\n[[가짜링크]]\n코드 내용 그대로\n```\n\n마지막 문단.";
    const r = checkCitations(answer, opened, resolve);
    expect(r.text).toBe(answer);
    expect(r.dropped).toEqual([]);
    expect(r.unsourced).toBe(3);
  });
});
