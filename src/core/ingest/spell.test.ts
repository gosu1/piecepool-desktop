// 깨진 낱말 되돌리기 — 원문이 사전이다.

import { describe, expect, it } from "vitest";
import { buildVocab, restoreTypos, restoreWord } from "./spell.ts";

describe("깨진 낱말", () => {
  const vocab = buildVocab([
    "해법을 찾는다. 내년 6월 졸업. 아무도 안 잰 것 같다. 운동을 시작했다. 무난하다. 정해진 순서.",
    "사과를 먹었다. 이해도가 높다.",
  ]);

  it("받침이 붙은 음절을 원문의 낱말로 되돌린다", () => {
    expect(restoreWord("핵법이", vocab)).toBe("해법이");
    expect(restoreWord("낸년", vocab)).toBe("내년");
    expect(restoreWord("욵동을", vocab)).toBe("운동을");
    expect(restoreWord("물난해서", vocab)).toBe("무난해서");
    expect(restoreWord("이핻도는", vocab)).toBe("이해도는");
  });

  it("세 음절부터는 모음이 바뀐 것도 되돌린다", () => {
    expect(restoreWord("아묘도", vocab)).toBe("아무도");
  });

  it("두 음절짜리 낱말은 모음을 바꾸지 않는다 — 사고를 사과로 만들지 않는다", () => {
    expect(restoreWord("사고", vocab)).toBeNull();
  });

  it("활용형을 어휘의 다른 낱말에 억지로 맞추지 않는다", () => {
    expect(restoreWord("정했다", vocab)).toBeNull();
  });

  it("원문에 있는 낱말은 건드리지 않고, 바꾼 자리는 알린다", () => {
    const fixes: string[] = [];
    const out = restoreTypos("졸업은 낸년 6월이고 핵법을 찾는다.", vocab, (a, b) =>
      fixes.push(`${a}→${b}`),
    );
    expect(out).toBe("졸업은 내년 6월이고 해법을 찾는다.");
    expect(fixes).toEqual(["낸년→내년", "핵법을→해법을"]);
  });
});
