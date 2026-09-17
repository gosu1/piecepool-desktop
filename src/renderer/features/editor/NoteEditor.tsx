// 노트 편집기 — CodeMirror 6 (legacy ADR-0004 의 결정을 승계).
//
// 확장(cm*·파서)은 gosu1/piecepool src/lib 에서 그대로 옮겼고, 이 파일은 새로 썼다.
// 옛 SlashBlockEditor 는 메모 캡처용(⌘Enter 제출·슬래시 메뉴)이라 참고만 했다 —
// 라이브 프리뷰(제목 크기·마크업 기호 숨김)와 `[[` 자동완성은 거기서 가져왔다.
//
// 편집기는 본문만 다룬다. 프론트매터는 화면에 없고, 저장할 때 main 이 원문의 것을 그대로 붙인다.
// 앱 편집기는 hashes 를 갱신하지 않는다 (CLAUDE.md §4).
import { useEffect, useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import {
  deleteMarkupBackward,
  insertNewlineContinueMarkup,
  markdown,
} from "@codemirror/lang-markdown";
import { Decoration, EditorView, ViewPlugin, keymap } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Prec, RangeSetBuilder } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { calloutPreview } from "./cmCallout.ts";
import { toggleMark } from "./cmFormat.ts";
import { mathPreview } from "./cmMath.ts";
import { refreshWikiTerms, wikiTermExtension } from "./cmWikiTerm.ts";

const theme = EditorView.theme({
  "&": { color: "var(--ds-ink)", fontSize: "15px", backgroundColor: "transparent" },
  ".cm-content": {
    fontFamily: "inherit",
    caretColor: "var(--ds-ink)",
    lineHeight: "1.6",
    padding: "16px 24px",
  },
  "&.cm-focused": { outline: "none" },
  // CM6 기본 테마는 포커스 시 연보라 선택 판을 박는다 — 다크에서 글자를 삼킨다. 같은 선택자로 되받는다.
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionLayer .cm-selectionBackground, & ::selection":
    { backgroundColor: "color-mix(in srgb, var(--ds-primary) 28%, transparent)" },
  ".cm-cursor": { borderLeftColor: "var(--ds-ink)" },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--ds-surface)",
    border: "1px solid var(--ds-hairline)",
    borderRadius: "8px",
    padding: "4px",
  },
  ".cm-tooltip-autocomplete ul li": {
    padding: "4px 8px",
    borderRadius: "4px",
    color: "var(--ds-ink-2)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--ds-surface-soft)",
    color: "var(--ds-ink)",
  },
});

// 라이브 프리뷰 — 마크다운 태그별 타이포. 타이핑과 동시에 문서처럼 보인다.
const liveMarkdown = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.75em", fontWeight: "700", lineHeight: "1.35" },
  { tag: tags.heading2, fontSize: "1.4em", fontWeight: "700", lineHeight: "1.4" },
  { tag: tags.heading3, fontSize: "1.18em", fontWeight: "600" },
  { tag: [tags.heading4, tags.heading5, tags.heading6], fontWeight: "600" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through", color: "var(--ds-ink-muted)" },
  { tag: tags.quote, color: "var(--ds-ink-muted)", fontStyle: "italic" },
  { tag: tags.link, color: "var(--ds-primary)" },
  { tag: tags.url, color: "var(--ds-ink-muted)" },
  { tag: tags.monospace, fontFamily: "ui-monospace, monospace", fontSize: "0.92em" },
  { tag: tags.contentSeparator, color: "var(--ds-ink-faint)" },
  { tag: tags.processingInstruction, color: "var(--ds-ink-faint)", fontWeight: "400" },
]);

// 마크업 기호(`# `, `**`, `*`) 감추기 — 커서가 닿지 않으면 화면에서만 지운다. 문서는 그대로다.
const hiddenMark = Decoration.replace({});

function markupDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const sel = view.state.selection.ranges;
  const activeLines = new Set<number>();
  for (const r of sel) {
    const first = doc.lineAt(r.from).number;
    const last = doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) activeLines.add(n);
  }
  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "HeaderMark") {
          // Setext 헤딩(밑줄 `===`)의 마크는 줄 전체다 — ATX("#") 만 다룬다.
          if (doc.sliceString(node.from, node.from + 1) !== "#") return;
          if (activeLines.has(doc.lineAt(node.from).number)) return;
          const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          builder.add(node.from, end, hiddenMark);
          return;
        }
        if (node.name !== "EmphasisMark" && node.name !== "StrikethroughMark") return;
        const parent = node.node.parent;
        if (!parent || touches(parent.from, parent.to)) return;
        builder.add(node.from, node.to, hiddenMark);
      },
    });
  }
  return builder.finish();
}

const hideMarkupMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = markupDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = markupDecorations(u.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    // 감춘 구간을 원자 단위로 — 화살표·backspace 가 보이지 않는 기호 안에 갇히지 않는다.
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none),
  },
);

// `[[` 뒤에서 노트·위키 제목을 제안한다. 사용자가 `[[이렇게]]` 적으면 정리하기가 그대로 링크로 살리므로,
// 이 자동완성이 곧 정리에 주는 강한 신호다.
function wikiLinkCompletion(getTitles: () => string[]) {
  return (context: CompletionContext) => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    const m = /\[\[([^[\]]*)$/.exec(before);
    if (!m) return null;
    const from = context.pos - m[1].length;
    const options: Completion[] = getTitles().map((t) => ({
      label: t,
      apply: (view, _c, aFrom, aTo) => {
        const after = view.state.doc.sliceString(aTo, aTo + 2);
        const end = after === "]]" ? aTo + 2 : aTo;
        view.dispatch({
          changes: { from: aFrom, to: end, insert: `${t}]]` },
          selection: { anchor: aFrom + t.length + 2 },
        });
      },
    }));
    return { from, options };
  };
}

// "[" 는 word 문자가 아니라 자동완성이 저절로 안 열린다 — 삽입을 감지해 명시적으로 연다.
const wikiLinkTrigger = EditorView.updateListener.of((u) => {
  if (!u.docChanged) return;
  let typed = false;
  u.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => {
    if (inserted.toString().endsWith("[")) typed = true;
  });
  if (typed) queueMicrotask(() => startCompletion(u.view));
});

// syntaxHighlighting:false — @uiw 기본 스타일을 끄고 liveMarkdown 만 쓴다(둘 다 켜면 클래스가 겹친다).
const BASIC_SETUP = {
  lineNumbers: false,
  foldGutter: false,
  highlightActiveLine: false,
  autocompletion: false,
  syntaxHighlighting: false,
} as const;

export function NoteEditor({
  value,
  onChange,
  titles,
  onOpenTitle,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 볼트의 노트·위키 제목. `[[` 자동완성과 본문 속 제목 강조에 쓴다. */
  titles: string[];
  /** 강조된 제목을 눌렀다 — 그 노트를 연다. */
  onOpenTitle: (title: string) => void;
}) {
  const viewRef = useRef<EditorView | null>(null);
  const titlesRef = useRef(titles);
  titlesRef.current = titles;
  const openRef = useRef(onOpenTitle);
  openRef.current = onOpenTitle;

  // 제목 목록이 바뀌면 편집 없이도 강조를 다시 그린다.
  const titlesKey = titles.join("\n");
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshWikiTerms.of(null) });
  }, [titlesKey]);

  // extensions 가 렌더마다 새 배열이면 @uiw 가 매 입력마다 에디터를 재구성해 팝업이 닫힌다 — 안정 참조.
  const extensions = useMemo(
    () => [
      markdown(),
      syntaxHighlighting(liveMarkdown),
      hideMarkupMarks,
      mathPreview,
      calloutPreview,
      EditorView.lineWrapping,
      theme,
      Prec.high(
        keymap.of([
          { key: "Enter", run: insertNewlineContinueMarkup },
          { key: "Backspace", run: deleteMarkupBackward },
          { key: "Mod-b", run: toggleMark("**") },
          { key: "Mod-i", run: toggleMark("*") },
        ]),
      ),
      wikiLinkTrigger,
      ...wikiTermExtension(
        () => titlesRef.current,
        (t) => openRef.current(t),
      ),
      autocompletion({
        override: [wikiLinkCompletion(() => titlesRef.current)],
        activateOnTyping: true,
        icons: false,
      }),
    ],
    [],
  );

  return (
    <CodeMirror
      value={value}
      theme="none"
      height="100%"
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view;
      }}
      basicSetup={BASIC_SETUP}
      className="h-full min-h-0 flex-1 overflow-auto"
    />
  );
}
