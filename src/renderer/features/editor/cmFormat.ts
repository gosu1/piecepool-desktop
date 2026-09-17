import type { EditorView } from "@codemirror/view";

// 인라인 서식 토글 (⌘B 볼드, ⌘I 기울임).
// 이미 감싸져 있으면 벗기고, 아니면 감싼다 — 같은 키를 두 번 누르면 원래대로 돌아온다.
// 마크다운 표준 문법만 쓴다: `**` 볼드, `*` 기울임.
// (밑줄은 마크다운에 문법이 없다 — <u> 를 쓰려면 렌더러에 rehype-raw + 정화 설정이 필요하므로 넣지 않았다.)

/** 문서에 가할 최소 편집 — [from, to) 구간을 insert 로 바꾸고 선택을 [selFrom, selTo) 로 옮긴다. */
export interface MarkEdit {
  from: number;
  to: number;
  insert: string;
  selFrom: number;
  selTo: number;
}

/**
 * 순수 계산 — 선택 구간에 마크를 토글한 결과. 세 갈래다.
 *  ① 선택이 마크를 품음:   [**굵게**]  → 굵게       (벗김)
 *  ② 마크가 선택 바깥:    **[굵게]**  → 굵게       (벗김)
 *  ③ 그 외:                [굵게]      → **굵게**   (감쌈)
 * 빈 선택이면 ③으로 마크만 넣고 커서를 가운데 둔다 — 바로 타이핑하면 서식 안에 들어간다.
 */
export function toggleMarkAt(doc: string, from: number, to: number, mark: string): MarkEdit {
  const n = mark.length;
  const sel = doc.slice(from, to);
  const wrap = (): MarkEdit => ({
    from,
    to,
    insert: `${mark}${sel}${mark}`,
    selFrom: from + n,
    selTo: from + n + sel.length,
  });

  // `*` 로 `**볼드**` 의 별 하나를 벗기면 마크다운이 깨진다("**x**" → "*x*", 볼드가 기울임이 된다).
  // 벗기기는 그 마크가 "정확히" 그 마크일 때만 한다 — 바로 옆에 별이 더 붙어 있으면 다른 서식이다.
  const star = mark === "*" || mark === "**";
  const exact = (at: number, dir: -1 | 1) => !star || doc[dir < 0 ? at - n - 1 : at + n] !== "*";

  // ① 선택이 마크를 품음: [**굵게**] → 굵게
  if (
    sel.length >= n * 2 &&
    sel.startsWith(mark) &&
    sel.endsWith(mark) &&
    sel[n] !== "*" &&
    sel[sel.length - n - 1] !== "*"
  ) {
    const inner = sel.slice(n, -n);
    return { from, to, insert: inner, selFrom: from, selTo: from + inner.length };
  }

  // ② 마크가 선택 바깥: **[굵게]** → 굵게
  if (
    from >= n &&
    doc.slice(from - n, from) === mark &&
    doc.slice(to, to + n) === mark &&
    exact(from, -1) &&
    exact(to, 1)
  ) {
    return {
      from: from - n,
      to: to + n,
      insert: sel,
      selFrom: from - n,
      selTo: from - n + sel.length,
    };
  }

  // ③ 감싼다. 빈 선택이면 마크만 넣고 커서를 가운데 둔다.
  return wrap();
}

/** CM6 커맨드. 주 선택 하나에만 적용한다(수집 에디터라 다중 커서는 쓰지 않는다). */
export function toggleMark(mark: string) {
  return (view: EditorView): boolean => {
    const r = view.state.selection.main;
    const e = toggleMarkAt(view.state.doc.toString(), r.from, r.to, mark);
    view.dispatch({
      changes: { from: e.from, to: e.to, insert: e.insert },
      selection: { anchor: e.selFrom, head: e.selTo },
      userEvent: "input.format",
    });
    return true;
  };
}
