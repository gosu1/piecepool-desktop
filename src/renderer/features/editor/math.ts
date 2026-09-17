// KaTeX 수식 구간 스캐너 — CM6 위젯(cmMath)과 테스트에서 공용.
// 문법 규약: docs/40-frontend/markdown-callout-math.md

export interface MathSpan {
  from: number; // 여는 $ 위치
  to: number; // 닫는 $ 다음 위치 (exclusive)
  src: string; // 구분자 제외 수식 원문
  display: boolean; // true = $$...$$ 블록
}

const DISPLAY = /\$\$([\s\S]+?)\$\$/g;
// 인라인은 $ 와 줄바꿈을 못 가로지른다 → greedy 도 첫 $ 에서 멈춘다.
const INLINE = /\$([^$\n]+)\$/g;

export function findMathSpans(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let m: RegExpExecArray | null;
  DISPLAY.lastIndex = 0;
  while ((m = DISPLAY.exec(text)) !== null) {
    if (m[1].trim())
      spans.push({ from: m.index, to: m.index + m[0].length, src: m[1], display: true });
  }
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    const src = m[1];
    const overlap = spans.find((s) => from < s.to && to > s.from);
    if (overlap) {
      INLINE.lastIndex = overlap.to; // display 내부 매치 — 구간 끝으로 점프
      continue;
    }
    // Pandoc 식 통화 방지: 여는 $ 뒤·닫는 $ 앞 공백 금지, 닫는 $ 뒤 숫자 금지 ($5 그리고 $10)
    if (/\s/.test(src[0]) || /\s/.test(src[src.length - 1]) || /\d/.test(text[to] ?? "")) {
      INLINE.lastIndex = from + 1; // 이 여는 $ 는 버리고 겹치는 대안 재탐색
      continue;
    }
    spans.push({ from, to, src, display: false });
  }
  return spans.sort((a, b) => a.from - b.from);
}
