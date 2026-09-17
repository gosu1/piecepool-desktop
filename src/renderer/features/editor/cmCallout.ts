// CM6 콜아웃 라이브 프리뷰 — `> [!easy] …` 블록을 색 배경+접기 셰브론으로.
// 커서가 블록 밖이면 `> ` 마크와 `[!easy]` 토큰을 감추고(hideHeaderMarks 패턴),
// 접기는 CM6 내장 codeFolding 을 쓴다(접힘 위치 추적을 CM 이 관리 — 커스텀 상태 불필요).
import { Decoration, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  codeFolding,
  foldEffect,
  foldedRanges,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import { parseCalloutMarker } from "./callout.ts";

interface CalloutBlock {
  type: string;
  titleLine: { from: number; to: number; number: number };
  markerFrom: number; // 제목 줄의 `[!타입]` 시작
  markerTo: number; // `[!타입]` + 뒤 공백 끝
  hasTitleText: boolean; // 마커 뒤 제목 텍스트 존재 — 없으면 마커를 감추지 않는다(빈 줄 방지)
  from: number; // 블록 시작
  to: number; // 블록 끝
}

const MARKER_TOKEN = /^\[!\w+\]\s?/;

/** 문서에서 콜아웃 블록(> [!type] …)을 찾는다. 중첩 인용 안쪽은 다루지 않는다. */
function findCalloutBlocks(state: EditorState, from?: number, to?: number): CalloutBlock[] {
  const doc = state.doc;
  const blocks: CalloutBlock[] = [];
  syntaxTree(state).iterate({
    from: from ?? 0,
    to: to ?? doc.length,
    enter: (node) => {
      if (node.name !== "Blockquote") return;
      const line = doc.lineAt(node.from);
      const quote = /^(\s*>\s?)/.exec(line.text);
      if (!quote) return false;
      const content = line.text.slice(quote[1].length);
      const marker = parseCalloutMarker(content);
      if (!marker) return false;
      const token = MARKER_TOKEN.exec(content);
      if (!token) return false;
      const markerFrom = line.from + quote[1].length;
      blocks.push({
        type: marker.type,
        titleLine: { from: line.from, to: line.to, number: line.number },
        markerFrom,
        markerTo: markerFrom + token[0].length,
        hasTitleText: content.slice(token[0].length).trim().length > 0,
        from: node.from,
        to: node.to,
      });
      return false; // 안쪽 중첩 인용은 무시
    },
  });
  return blocks;
}

function isFolded(view: EditorView, foldFrom: number): boolean {
  let folded = false;
  foldedRanges(view.state).between(foldFrom, foldFrom, (rf) => {
    if (rf === foldFrom) folded = true;
  });
  return folded;
}

class ChevronWidget extends WidgetType {
  readonly foldFrom: number;
  readonly foldTo: number;
  readonly folded: boolean;
  constructor(foldFrom: number, foldTo: number, folded: boolean) {
    super();
    this.foldFrom = foldFrom;
    this.foldTo = foldTo;
    this.folded = folded;
  }
  eq(other: ChevronWidget) {
    return (
      other.foldFrom === this.foldFrom &&
      other.foldTo === this.foldTo &&
      other.folded === this.folded
    );
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "pp-callout-chevron" + (this.folded ? "" : " pp-open");
    // 아래 방향 셰브론 — 펼치면 위로 회전(pp-open). 폰트 의존 줄이려 SVG.
    el.innerHTML =
      '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    el.setAttribute("aria-label", this.folded ? "펼치기" : "접기");
    el.onmousedown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const effect = this.folded ? unfoldEffect : foldEffect;
      view.dispatch({ effects: effect.of({ from: this.foldFrom, to: this.foldTo }) });
    };
    return el;
  }
}

const hiddenMark = Decoration.replace({});

function calloutDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const ranges: Range<Decoration>[] = [];

  // fold 로 visibleRanges 가 쪼개지면 경계에 걸친 블록이 두 구간에서 중복 발견될 수 있다 → 시작 위치로 dedup.
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    for (const b of findCalloutBlocks(view.state, from, to)) {
      if (seen.has(b.from)) continue;
      seen.add(b.from);
      const lastLine = doc.lineAt(b.to).number;

      // 접기 셰브론 — 여러 줄 블록에만. 제목 줄 맨 앞(마크 앞)에 붙는다.
      if (lastLine > b.titleLine.number) {
        const folded = isFolded(view, b.titleLine.to);
        ranges.push(
          Decoration.widget({
            widget: new ChevronWidget(b.titleLine.to, b.to, folded),
            side: -1,
          }).range(b.titleLine.from),
        );
      }

      for (let n = b.titleLine.number; n <= lastLine; n++) {
        const line = doc.line(n);
        ranges.push(
          Decoration.line({
            class:
              n === b.titleLine.number
                ? "pp-callout-line pp-callout-title-line"
                : "pp-callout-line",
          }).range(line.from),
        );
        // 읽기 전용이라 `> `·`[!easy]` 마크를 항상 감춘다(커서와 무관하게 깔끔 — 문법 노출 없음).
        const q = /^(\s*>\s?)/.exec(line.text);
        if (q && q[1].length) ranges.push(hiddenMark.range(line.from, line.from + q[1].length));
        if (n === b.titleLine.number && b.hasTitleText)
          ranges.push(hiddenMark.range(b.markerFrom, b.markerTo));
      }
    }
  }
  // 라인·위젯·replace 가 섞여 builder 의 엄격한 순서 요건이 까다롭다 → sort 허용하는 set 으로.
  return Decoration.set(ranges, true);
}

const calloutPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = calloutDecorations(view);
      // 마운트 시 완성된 [!easy] 블록은 접어 둔다. 생성자 안 dispatch 금지 → 마이크로태스크.
      queueMicrotask(() => foldEasyCallouts(view));
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.transactions.some((t) => t.effects.length)
      ) {
        this.decorations = calloutDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

/** 아직 안 접힌 [!easy] 블록을 전부 접는다. 스트림 완료 시·마운트 시 1회 호출. */
export function foldEasyCallouts(view: EditorView): void {
  const effects = findCalloutBlocks(view.state)
    .filter(
      (b) =>
        b.type === "easy" &&
        view.state.doc.lineAt(b.to).number > b.titleLine.number &&
        !isFolded(view, b.titleLine.to),
    )
    .map((b) => foldEffect.of({ from: b.titleLine.to, to: b.to }));
  if (effects.length) view.dispatch({ effects });
}

const calloutTheme = EditorView.baseTheme({
  ".pp-callout-line": {
    backgroundColor: "var(--ds-surface-soft)",
    borderLeft: "2px solid var(--ds-primary)",
    paddingLeft: "10px",
  },
  // 제목 줄 = 접기 바. 오른쪽 셰브론 자리를 padding 으로 비우고, 전체를 눌러 펼칠 수 있게 pointer.
  ".pp-callout-title-line": {
    fontWeight: "600",
    position: "relative",
    paddingRight: "26px",
    cursor: "pointer",
  },
  // 셰브론 — 오른쪽 끝, 히트영역 22px. 접힘=아래 방향, 펼침=위(180°).
  ".pp-callout-chevron": {
    position: "absolute",
    right: "4px",
    top: "0",
    bottom: "0",
    width: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--ds-ink-faint)",
    cursor: "pointer",
    transition: "transform 160ms ease, color 110ms ease",
    transform: "rotate(0deg)",
  },
  ".pp-callout-chevron.pp-open": { transform: "rotate(180deg)" },
  // 제목 줄 호버 시 셰브론이 프라이머리로 — 누를 수 있다는 신호(테마 안전 토큰만 사용).
  ".pp-callout-title-line:hover .pp-callout-chevron": { color: "var(--ds-primary)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "transparent",
    border: "none",
    padding: "0",
    margin: "0",
  },
});

// 접힌 자리의 "…" 기본 placeholder 를 없앤다 — 접힘 표시는 오른쪽 셰브론이 대신한다.
const emptyFoldPlaceholder = codeFolding({ placeholderDOM: () => document.createElement("span") });

// 콜아웃(제목+본문) 어디를 눌러도 커서가 들어가지 않게 한다 — 읽기 전용 AI 산출물이라
// 편집도, `> `·`**`·`####` 같은 마크다운 문법 노출도 원천 차단. 제목 줄 클릭은 접기 토글.
const calloutClick = EditorView.domEventHandlers({
  mousedown(e, view) {
    const t = e.target as HTMLElement | null;
    if (!t || t.closest(".pp-callout-chevron")) return false; // 셰브론은 자기 핸들러가 토글(이중 처리 방지)
    const lineEl = t.closest(".pp-callout-line") as HTMLElement | null;
    if (!lineEl) return false;
    e.preventDefault(); // 커서 진입 차단 → 마크다운 문법이 드러나지 않는다
    // 제목 줄이면 접기 토글(본문 줄은 커서 차단만).
    if (lineEl.classList.contains("pp-callout-title-line")) {
      const line = view.state.doc.lineAt(view.posAtDOM(lineEl));
      const block = findCalloutBlocks(view.state).find((b) => b.titleLine.number === line.number);
      if (block && view.state.doc.lineAt(block.to).number > block.titleLine.number) {
        const folded = isFolded(view, block.titleLine.to);
        view.dispatch({
          effects: (folded ? unfoldEffect : foldEffect).of({
            from: block.titleLine.to,
            to: block.to,
          }),
        });
      }
    }
    return true;
  },
});

export const calloutPreview: Extension = [
  emptyFoldPlaceholder,
  calloutPlugin,
  calloutTheme,
  calloutClick,
];
