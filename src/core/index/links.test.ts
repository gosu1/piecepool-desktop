import { describe, expect, it } from "vitest";
import { backlinksOf, normalizeTitle, parseLinks, resolveLink } from "./links.ts";
import type { LinkTargets } from "./links.ts";
import type { LinkRef } from "../../shared/types.ts";

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

describe("resolveLink", () => {
  const targets: LinkTargets = {
    titles: new Map([
      [normalizeTitle("CNN"), "wiki/CNN.md"],
      [normalizeTitle("교착 상태"), "wiki/교착상태.md"],
    ]),
    files: new Set(["wiki/CNN.md", "wiki/교착상태.md", "sources/files/x.pdf"]),
  };

  it("제목으로 해석한다", () => {
    expect(resolveLink("a.md", "CNN", targets)).toBe("wiki/CNN.md");
  });

  it("공백이 달라도 같은 노트로 해석한다", () => {
    expect(resolveLink("a.md", "교착상태", targets)).toBe("wiki/교착상태.md");
  });

  it("경로로도 해석한다", () => {
    expect(resolveLink("a.md", "sources/files/x.pdf", targets)).toBe("sources/files/x.pdf");
  });

  it("없는 대상은 null 이다 — 깨진 링크다", () => {
    expect(resolveLink("a.md", "없는것", targets)).toBeNull();
  });

  it("같은 문자열이 제목과(다른 노트의) 경로 둘 다에 걸리면 제목이 이긴다", () => {
    const collide: LinkTargets = {
      titles: new Map([[normalizeTitle("CNN"), "wiki/CNN.md"]]),
      // "CNN" 이 wiki/CNN.md 와 무관한 다른 파일의 리터럴 경로이기도 하다.
      files: new Set(["wiki/CNN.md", "CNN"]),
    };
    expect(resolveLink("a.md", "CNN", collide)).toBe("wiki/CNN.md");
  });
});

describe("backlinksOf", () => {
  const ref = (over: Partial<LinkRef>): LinkRef => ({
    from: "b.md",
    to: "제목",
    embed: false,
    resolved: "a.md",
    ...over,
  });

  it("가리키는 노트를 찾는다", () => {
    expect(backlinksOf("a.md", [ref({ from: "b.md" })])).toEqual(["b.md"]);
  });

  it("깨진 링크(resolved === null)는 안 센다", () => {
    expect(backlinksOf("a.md", [ref({ from: "b.md", resolved: null })])).toEqual([]);
  });

  it("자기 링크(from === resolved)는 안 센다", () => {
    expect(backlinksOf("a.md", [ref({ from: "a.md", resolved: "a.md" })])).toEqual([]);
  });

  it("같은 노트가 두 번 가리켜도 한 번만 돌려준다", () => {
    const all = [ref({ from: "b.md" }), ref({ from: "b.md", to: "딴이름" })];
    expect(backlinksOf("a.md", all)).toEqual(["b.md"]);
  });

  it("정렬해서 돌려준다", () => {
    const all = [ref({ from: "z.md" }), ref({ from: "b.md" })];
    expect(backlinksOf("a.md", all)).toEqual(["b.md", "z.md"]);
  });

  it("임베드(![[...]])도 포함한다", () => {
    expect(backlinksOf("a.md", [ref({ from: "b.md", embed: true })])).toEqual(["b.md"]);
  });

  it("가리키는 것이 없으면 빈 배열이다", () => {
    expect(backlinksOf("a.md", [ref({ from: "b.md", resolved: "z.md" })])).toEqual([]);
  });
});
