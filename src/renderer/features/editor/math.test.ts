import { describe, it, expect } from "vitest";
import { findMathSpans } from "./math.ts";

describe("findMathSpans — inline $...$", () => {
  it("matches a simple inline formula with offsets", () => {
    const text = "피타고라스: $a^2+b^2=c^2$ 이다";
    const spans = findMathSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].display).toBe(false);
    expect(spans[0].src).toBe("a^2+b^2=c^2");
    expect(text.slice(spans[0].from, spans[0].to)).toBe("$a^2+b^2=c^2$");
  });
  it("통화 표기($5 그리고 $10)는 매치하지 않는다", () => {
    expect(findMathSpans("가격은 $5 그리고 $10 이다")).toEqual([]);
  });
  it("여는 $ 뒤 공백 / 닫는 $ 앞 공백이면 매치하지 않는다", () => {
    expect(findMathSpans("a $ x$ b")).toEqual([]);
    expect(findMathSpans("a $x $ b")).toEqual([]);
  });
  it("줄바꿈을 가로지르는 인라인은 매치하지 않는다", () => {
    expect(findMathSpans("$a\n+b$")).toEqual([]);
  });
  it("인접한 두 인라인 수식을 각각 매치한다", () => {
    const spans = findMathSpans("$a$$b$");
    expect(spans.map((s) => s.src)).toEqual(["a", "b"]);
  });
});

describe("findMathSpans — display $$...$$", () => {
  it("matches a multi-line block with display=true", () => {
    const text = "수식:\n$$\nE = mc^2\n$$\n끝";
    const spans = findMathSpans(text);
    expect(spans).toHaveLength(1);
    expect(spans[0].display).toBe(true);
    expect(spans[0].src.trim()).toBe("E = mc^2");
    expect(text.slice(spans[0].from, spans[0].to)).toBe("$$\nE = mc^2\n$$");
  });
  it("한 줄 $$x$$ 도 display 로 매치한다", () => {
    const spans = findMathSpans("앞 $$x_i$$ 뒤");
    expect(spans).toHaveLength(1);
    expect(spans[0].display).toBe(true);
    expect(spans[0].src).toBe("x_i");
  });
  it("스트리밍 중 미완 $$ 는 매치하지 않는다", () => {
    expect(findMathSpans("도출: $$a+b")).toEqual([]);
  });
  it("빈 수식($$$$, $$)은 매치하지 않는다", () => {
    expect(findMathSpans("$$$$")).toEqual([]);
    expect(findMathSpans("a $$ b")).toEqual([]);
  });
  it("display 와 inline 이 섞이면 둘 다 오름차순으로 반환", () => {
    const text = "$a$ 그리고\n$$b$$";
    const spans = findMathSpans(text);
    expect(spans.map((s) => [s.src, s.display])).toEqual([
      ["a", false],
      ["b", true],
    ]);
    expect(spans[0].from).toBeLessThan(spans[1].from);
  });
});
