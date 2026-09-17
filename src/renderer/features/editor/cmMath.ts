// CM6 수식 라이브 프리뷰 — 평소엔 KaTeX 렌더, 커서가 닿으면(인접 포함) 원문 $...$ 노출.
// 클릭 → ignoreEvent(false) 로 커서가 수식 위치에 놓임 → 다음 업데이트에서 원문이 드러난다.
// 블록 위젯은 세로 레이아웃을 바꾸므로 ViewPlugin 이 아닌 StateField 로 제공한다(CM6 규칙).
import katex from "katex";
import "katex/dist/katex.min.css";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { StateField, type EditorState, type Extension, type Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { findMathSpans, type MathSpan } from "./math.ts";

class MathWidget extends WidgetType {
  readonly src: string;
  readonly display: boolean;
  constructor(src: string, display: boolean) {
    super();
    this.src = src;
    this.display = display;
  }
  // eq 가 같으면 CM 이 toDOM 을 다시 부르지 않는다 — 스트리밍 중 바뀐 수식만 재렌더.
  eq(other: MathWidget) {
    return other.src === this.src && other.display === this.display;
  }
  toDOM() {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "pp-math pp-math-display" : "pp-math";
    try {
      katex.render(this.src, el, { throwOnError: false, displayMode: this.display });
    } catch {
      el.textContent = this.src; // KaTeX 파스 불능 — 원문 그대로
    }
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function inCodeContext(state: EditorState, pos: number): boolean {
  for (
    let n: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1);
    n;
    n = n.parent as never
  ) {
    if (n.name.includes("Code")) return true; // InlineCode/FencedCode — 코드 안의 $ 는 수식이 아니다
  }
  return false;
}

function mathDecorations(state: EditorState, spans: MathSpan[]): DecorationSet {
  if (!spans.length) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  for (const s of spans) {
    // 커서/선택이 구간에 닿으면(양끝 인접 포함) 원문을 보여준다.
    if (state.selection.ranges.some((r) => r.from <= s.to && r.to >= s.from)) continue;
    if (inCodeContext(state, s.from)) continue;
    // 줄 전체를 차지하는 display 수식만 block 위젯 — 그 외엔 인라인로 렌더(줄 병합 허용).
    const wholeLines =
      state.doc.lineAt(s.from).from === s.from && state.doc.lineAt(s.to).to === s.to;
    const block = s.display && wholeLines;
    ranges.push(
      Decoration.replace({ widget: new MathWidget(s.src, block), block }).range(s.from, s.to),
    );
  }
  return Decoration.set(ranges, true);
}

// 스팬 스캔(문서 전체 문자열화 + 정규식)은 비싸다 — 문서가 바뀔 때만 다시 훑고,
// 커서/선택만 바뀌면 캐시한 스팬으로 데코만 재구성한다(긴 요약에서 커서 이동 렉 방지).
interface MathState {
  deco: DecorationSet;
  spans: MathSpan[];
}
const mathField = StateField.define<MathState>({
  create(state) {
    const spans = findMathSpans(state.doc.toString());
    return { spans, deco: mathDecorations(state, spans) };
  },
  update(prev, tr) {
    if (tr.docChanged) {
      const spans = findMathSpans(tr.state.doc.toString());
      return { spans, deco: mathDecorations(tr.state, spans) };
    }
    if (tr.selection) return { spans: prev.spans, deco: mathDecorations(tr.state, prev.spans) };
    return prev;
  },
  provide: (f) => EditorView.decorations.from(f, (s) => s.deco),
});

const mathTheme = EditorView.baseTheme({
  ".pp-math-display": { padding: "4px 0", textAlign: "center" },
});

export const mathPreview: Extension = [mathField, mathTheme];
