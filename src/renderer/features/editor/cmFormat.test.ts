import { describe, it, expect } from "vitest";
import { toggleMarkAt, type MarkEdit } from "./cmFormat.ts";

// 편집을 적용해 최종 문서와 선택을 눈으로 확인한다 — [선택] 을 대괄호로 표시.
function apply(doc: string, e: MarkEdit): string {
  const next = doc.slice(0, e.from) + e.insert + doc.slice(e.to);
  return (
    next.slice(0, e.selFrom) + "[" + next.slice(e.selFrom, e.selTo) + "]" + next.slice(e.selTo)
  );
}

const B = "**";
const I = "*";

describe("toggleMarkAt — 감싸기", () => {
  it("선택을 마크로 감싸고, 커서는 마크 안쪽에 남는다", () => {
    const doc = "어텐션은 중요하다"; // "중요하다" = 5..9
    expect(apply(doc, toggleMarkAt(doc, 5, 9, B))).toBe("어텐션은 **[중요하다]**");
  });

  it("기울임도 같다", () => {
    const doc = "어텐션은 중요하다";
    expect(apply(doc, toggleMarkAt(doc, 5, 9, I))).toBe("어텐션은 *[중요하다]*");
  });

  it("빈 선택이면 마크만 넣고 커서를 가운데 둔다 — 바로 타이핑하면 서식 안에 들어간다", () => {
    expect(apply("", toggleMarkAt("", 0, 0, B))).toBe("**[]**");
  });
});

describe("toggleMarkAt — 벗기기 (같은 키를 두 번 누르면 원래대로)", () => {
  it("선택이 마크를 품고 있으면 벗긴다", () => {
    const doc = "어텐션은 **중요하다**"; // "**중요하다**" = 5..13
    expect(apply(doc, toggleMarkAt(doc, 5, 13, B))).toBe("어텐션은 [중요하다]");
  });

  it("마크가 선택 바깥에 있어도 벗긴다 — 글자만 드래그한 흔한 경우", () => {
    const doc = "어텐션은 **중요하다**"; // "중요하다" = 7..11
    expect(apply(doc, toggleMarkAt(doc, 7, 11, B))).toBe("어텐션은 [중요하다]");
  });

  it("감쌌다 다시 누르면 원문으로 돌아온다 (왕복)", () => {
    const doc = "중요하다";
    const e1 = toggleMarkAt(doc, 0, 4, B);
    const wrapped = doc.slice(0, e1.from) + e1.insert + doc.slice(e1.to);
    expect(wrapped).toBe("**중요하다**");
    // 감싼 뒤 선택은 마크 안쪽 — 그 상태에서 다시 토글하면 원문으로.
    const e2 = toggleMarkAt(wrapped, e1.selFrom, e1.selTo, B);
    expect(wrapped.slice(0, e2.from) + e2.insert + wrapped.slice(e2.to)).toBe(doc);
  });
});

// 회귀: `*` 로 `**볼드**` 의 별 하나를 벗기면 "**x**" → "*x*" 가 되어 볼드가 기울임으로 바뀐다.
// 벗기기는 그 마크가 "정확히" 그 마크일 때만 해야 한다 — 옆에 별이 더 붙어 있으면 다른 서식이다.
describe("toggleMarkAt — 볼드와 기울임이 서로를 먹지 않는다", () => {
  it("볼드 안쪽에 기울임을 걸면 벗기지 않고 중첩한다", () => {
    const doc = "**중요하다**"; // 안쪽 "중요하다" = 2..6
    expect(apply(doc, toggleMarkAt(doc, 2, 6, I))).toBe("***[중요하다]***");
  });

  it("기울임 안쪽에 볼드를 걸면 벗기지 않고 중첩한다", () => {
    const doc = "*중요*"; // 안쪽 "중요" = 1..3
    expect(apply(doc, toggleMarkAt(doc, 1, 3, B))).toBe("***[중요]***");
  });

  it("볼드는 볼드로 정상 벗겨진다 (위 가드가 정상 경로를 막지 않는다)", () => {
    const doc = "**중요**";
    expect(apply(doc, toggleMarkAt(doc, 2, 4, B))).toBe("[중요]");
  });
});

describe("toggleMarkAt — 경계", () => {
  it("문서 맨 앞 선택에서 앞쪽 마크를 찾다가 음수 인덱스로 새지 않는다", () => {
    const doc = "중요";
    expect(apply(doc, toggleMarkAt(doc, 0, 2, B))).toBe("**[중요]**");
  });

  // 양쪽이 짝지어져 있을 때만 벗긴다. 한쪽만 있는 건 이미 깨진 마크다운이라 감싸는 쪽이 안전하다 —
  // 벗기려 들면 남은 짝을 지워 다른 구절의 서식까지 무너뜨릴 수 있다.
  it("마크가 한쪽에만 있으면 벗기지 않고 감싼다", () => {
    const doc = "**중요";
    expect(apply(doc, toggleMarkAt(doc, 2, 4, B))).toBe("****[중요]**");
  });
});
