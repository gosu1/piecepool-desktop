import { describe, expect, it } from "vitest";
import { normalizeTitle, parseLinks } from "./links.ts";

describe("normalizeTitle", () => {
  it("공백을 지운다 — 구 레포 PIE-64 가 이것으로 막힌다", () => {
    expect(normalizeTitle("교착 상태")).toBe(normalizeTitle("교착상태"));
  });

  it("NFD 로 쓴 한글과 NFC 로 쓴 한글을 같은 키로 만든다", () => {
    const nfc = "트랜스포머";
    const nfd = nfc.normalize("NFD");
    expect(nfd).not.toBe(nfc);
    expect(normalizeTitle(nfd)).toBe(normalizeTitle(nfc));
  });

  it("대소문자를 가리지 않는다", () => {
    expect(normalizeTitle("Transformer")).toBe(normalizeTitle("transformer"));
  });

  it("앞뒤 공백과 탭을 지운다", () => {
    expect(normalizeTitle("  CNN\t")).toBe("cnn");
  });
});

describe("parseLinks", () => {
  it("맨 링크를 읽는다", () => {
    expect(parseLinks("a.md", "본문 [[CNN]] 끝")).toEqual([
      { from: "a.md", to: "CNN", embed: false, resolved: null },
    ]);
  });

  it("별칭을 가른다", () => {
    expect(parseLinks("a.md", "[[CNN|합성곱 신경망]]")).toEqual([
      { from: "a.md", to: "CNN", embed: false, alias: "합성곱 신경망", resolved: null },
    ]);
  });

  it("소제목 fragment 는 버린다", () => {
    expect(parseLinks("a.md", "[[CNN#구조]]")).toEqual([
      { from: "a.md", to: "CNN", embed: false, resolved: null },
    ]);
  });

  it("블록 id fragment 도 버린다", () => {
    expect(parseLinks("a.md", "[[CNN#^abc123]]")).toEqual([
      { from: "a.md", to: "CNN", embed: false, resolved: null },
    ]);
  });

  it("임베드를 embed 로 표시한다", () => {
    expect(parseLinks("a.md", "![[sources/files/x.pdf]]")).toEqual([
      { from: "a.md", to: "sources/files/x.pdf", embed: true, resolved: null },
    ]);
  });

  it("#page=N 은 page 로 분리한다 — 1-indexed 정수다", () => {
    expect(parseLinks("a.md", "![[sources/files/x.pdf#page=7]]")).toEqual([
      { from: "a.md", to: "sources/files/x.pdf", embed: true, page: 7, resolved: null },
    ]);
  });

  it("괄호가 든 제목을 통째로 담는다", () => {
    expect(parseLinks("a.md", "[[@DETR (2020)]]")[0].to).toBe("@DETR (2020)");
  });

  it("한 줄에 여러 개를 전부 읽는다", () => {
    expect(parseLinks("a.md", "[[가]] 그리고 [[나]]").map((r) => r.to)).toEqual(["가", "나"]);
  });

  it("닫히지 않은 [[ 는 링크가 아니다", () => {
    expect(parseLinks("a.md", "[[열기만 함")).toEqual([]);
  });

  it("빈 링크는 버린다", () => {
    expect(parseLinks("a.md", "[[]] [[   ]] [[|표시]]")).toEqual([]);
  });

  it("코드 펜스 안의 [[예시]] 는 링크가 아니다", () => {
    const body = ["설명", "```md", "[[예시]]", "```", "[[진짜]]"].join("\n");
    expect(parseLinks("a.md", body).map((r) => r.to)).toEqual(["진짜"]);
  });

  it("~~~ 펜스도 막는다", () => {
    const body = ["~~~", "[[예시]]", "~~~", "[[진짜]]"].join("\n");
    expect(parseLinks("a.md", body).map((r) => r.to)).toEqual(["진짜"]);
  });

  it("긴 펜스 안의 짧은 펜스는 블록을 닫지 못한다", () => {
    // 백틱 넷으로 연 블록 안의 백틱 셋은 예제일 뿐이다.
    // CommonMark 는 닫는 런이 여는 런 이상이기를 요구한다.
    const body = ["````", "```", "[[예시]]", "```", "````", "[[진짜]]"].join("\n");
    expect(parseLinks("a.md", body).map((r) => r.to)).toEqual(["진짜"]);
  });

  it("인라인 코드 안의 [[예시]] 는 링크가 아니다", () => {
    expect(
      parseLinks("a.md", "`[[예시]]` 는 문법이고 [[진짜]] 는 링크다").map((r) => r.to),
    ).toEqual(["진짜"]);
  });

  it("닫히지 않은 펜스는 파일 끝까지 삼킨다", () => {
    const body = ["```", "[[예시]]", "[[또예시]]"].join("\n");
    expect(parseLinks("a.md", body)).toEqual([]);
  });
});
