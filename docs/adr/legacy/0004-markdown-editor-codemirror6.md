> **상태: 대체됨.** 구 레포(Tauri+Rust)의 ADR 원문이다. 근거 보존용이며
> 새 번호 체계(`docs/adr/`) 밖에 있다. 재구축 결정은 `docs/adr/0001-*.md` 참조.

# ADR-0004: Markdown 편집기 — CodeMirror 6

- 상태: 채택 (Accepted)
- 일자: 2026-06-25
- 관련: [markdown-editor](../40-frontend/screens/markdown-editor.md) · [wikilink-embed](../10-contracts/wikilink-embed.md)

## 배경

archive/wiki 편집기가 필요하다. `[[...]]`/`![[...]]` 커스텀 렌더링을 본문에 그대로 보존해야 하므로, 링크를 자동 변환하는 올인원/WYSIWYG(TipTap·Lexical 등)는 충돌한다.

## 결정

**CodeMirror 6**(`@uiw/react-codemirror`)를 채택한다. raw 마크다운 좌측 편집 + 우측 미리보기 분리(split view). 미리보기는 wikilink/embed 커스텀 컴포넌트를 재사용한다.

## 결과

- (+) `[[...]]`/`![[...]]` 원문 보존, 커스텀 렌더링과 무충돌.
- (−) WYSIWYG 대비 초기 편집 UX 러프 → 미리보기로 보완.

## 대안

- TipTap/Lexical(WYSIWYG): wikilink 자동 변환이 커스텀 렌더링과 충돌 → 기각.
