# ADR-0001 — Electron 셸 + LLM Wiki 방식으로 재구축

- 날짜: 2026-09-05
- 상태: 채택됨

## 맥락

기존 PiecePool은 Tauri + Rust(4,811줄) 백엔드에 React 프론트엔드를 얹은 구조였다.
지식 모델은 타입이 붙은 관계 그래프 — `RelationType` 12종과 노드 호환성 매트릭스,
`relations.json` 저장소, LLM 출력을 `LlmWikiResult`로 받아 스키마 검증 후 반영하는 파이프라인.

## 결정

셸과 지식 모델을 동시에 바꾼다.

| 축 | 기존 | 신규 |
|---|---|---|
| 셸 | Tauri + Rust | Electron + Node/TS |
| 지식 모델 | 타입 관계 그래프 | 타입 없는 `[[]]` 링크 |
| LLM 쓰기 | JSON 제안 → 검증 → 앱이 반영 | 에이전트가 파일을 직접 편집 |
| 진실의 소재 | `relations.json` + 마크다운 | 마크다운 파일만 |
| 안전망 | 저장 전 검증 게이트 | 볼트 git 커밋 + 되돌리기 |

참고한 패턴은 카파시의 LLM Wiki — "Obsidian이 IDE, LLM이 프로그래머, 위키가 코드베이스".
자료를 색인만 하지 않고 에이전트가 읽어 기존 페이지를 갱신·교차링크·중복제거한다.

## 결과

- 파일이 유일한 진실이므로 저장을 막을 근거가 사라진다.
  검증은 게이트가 아니라 `lint()`가 나중에 보고하는 관찰로 내려간다
- 에이전트에게 쓰기 권한을 주는 대가로 되돌리기가 필수가 된다.
  볼트 자체를 git 저장소로 두고, 에이전트가 쓴 경로만 커밋한다
- 되돌리기의 입자가 파일 단위다. 에이전트가 페이지를 재작성하므로
  문단 단위 취소는 불가능하다 — 직후 취소 용도로 본다
- Rust를 버리면서 PDF 추출의 이중 경로가 사라진다.
  `pdfjs-dist` legacy 빌드를 순수 Node에서 단독 추출기로 쓴다

## 참고

- 전체 설계: `docs/superpowers/specs/2026-09-05-electron-rebuild-design.md`
- 0단계 골격: `docs/superpowers/specs/2026-09-06-repo-skeleton-design.md`
- 구 레포 ADR 원문: `docs/adr/legacy/` (상태: 대체됨)
