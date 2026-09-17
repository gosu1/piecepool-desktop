// 본문 키워드 → 위키 데코레이션(CM6). 표시 전용 — 문서는 안 바꾼다(hideMarkupMarks 와 같은 결).
// terms 는 getTerms() 로 매번 읽는다(부모 ref) — 목록이 바뀌면 부모가 refreshWikiTerms 를
// dispatch 해 편집 없이도 다시 그린다. 스펙 §4.

import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { RangeSetBuilder, StateEffect } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import {
  buildTermMatcher,
  findTermMatches,
  findExcludedRanges,
  type TermMatcher,
} from "./wikiTerms.ts";

export const refreshWikiTerms = StateEffect.define<null>();

// 매치를 걸지 않을 구문 노드 — 코드·URL·마크다운 링크(위키링크는 텍스트 규칙이 잡는다).
const SKIP_NODES = new Set([
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "URL",
  "Autolink",
  "Link",
  "Image",
]);

/** 보이는 범위 텍스트의 데코 범위(문서 좌표) — 텍스트 규칙 + syntaxTree 코드 범위 둘 다 제외. */
export function termDecoRanges(
  text: string,
  offset: number,
  matcher: TermMatcher,
  codeRanges: Array<{ from: number; to: number }>,
): Array<{ from: number; to: number; title: string }> {
  const excluded = [
    ...findExcludedRanges(text),
    ...codeRanges.map((r) => ({ from: r.from - offset, to: r.to - offset })),
  ];
  return findTermMatches(text, matcher, excluded).map((m) => ({
    from: m.from + offset,
    to: m.to + offset,
    title: m.title,
  }));
}

function buildDeco(view: EditorView, matcher: TermMatcher | null): DecorationSet {
  if (!matcher) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const codeRanges: Array<{ from: number; to: number }> = [];
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (SKIP_NODES.has(node.name)) codeRanges.push({ from: node.from, to: node.to });
      },
    });
    for (const r of termDecoRanges(view.state.sliceDoc(from, to), from, matcher, codeRanges)) {
      builder.add(
        r.from,
        r.to,
        Decoration.mark({ class: "cm-wiki-term", attributes: { "data-wiki-term": r.title } }),
      );
    }
  }
  return builder.finish();
}

const termTheme = EditorView.theme({
  ".cm-wiki-term": {
    backgroundColor: "color-mix(in srgb, var(--ds-primary) 9%, transparent)",
    borderRadius: "3px",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textDecorationColor: "color-mix(in srgb, var(--ds-primary) 55%, transparent)",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  ".cm-wiki-term:hover": {
    backgroundColor: "color-mix(in srgb, var(--ds-primary) 18%, transparent)",
  },
});

export function wikiTermExtension(
  getTerms: () => string[],
  onClick: (title: string) => void,
): Extension[] {
  // matcher 는 terms 내용이 바뀔 때만 재생성 — 매 update 재빌드는 낭비.
  let matcher: TermMatcher | null = null;
  let key: string | null = null;
  const ensure = () => {
    const terms = getTerms();
    const k = terms.join("\n");
    if (k !== key) {
      key = k;
      matcher = buildTermMatcher(terms);
    }
    return matcher;
  };
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDeco(view, ensure());
      }
      update(u: ViewUpdate) {
        const refreshed = u.transactions.some((tr) =>
          tr.effects.some((e) => e.is(refreshWikiTerms)),
        );
        if (u.docChanged || u.viewportChanged || refreshed)
          this.decorations = buildDeco(u.view, ensure());
      }
    },
    { decorations: (v) => v.decorations },
  );
  const click = EditorView.domEventHandlers({
    click: (e, view) => {
      const el = (e.target as HTMLElement | null)?.closest?.(".cm-wiki-term");
      const title = el?.getAttribute("data-wiki-term");
      if (!title) return false;
      if (!view.state.selection.main.empty) return false; // 드래그 선택은 클릭이 아니다
      onClick(title);
      return false; // 기본 처리(커서 이동)는 그대로 — 위키만 옆에 연다
    },
  });
  return [plugin, click, termTheme];
}
