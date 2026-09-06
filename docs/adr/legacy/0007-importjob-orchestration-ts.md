> **상태: 대체됨.** 구 레포(Tauri+Rust)의 ADR 원문이다. 근거 보존용이며
> 새 번호 체계(`docs/adr/`) 밖에 있다. 재구축 결정은 `docs/adr/0001-*.md` 참조.

# ADR-0007: ImportJob 오케스트레이션 — TS 서비스층 주도

- 상태: 채택 (Accepted)
- 일자: 2026-07-01
- 관련: [import-pipeline](../20-backend/import-pipeline.md) · [import-job-states](../20-backend/import-job-states.md) · [ipc-api](../20-backend/ipc-api.md) · [entities](../10-contracts/entities.md)

## 배경

`import-pipeline.md` §2가 오케스트레이션 주도 주체를 미확정(TBD)으로 남겼다: "TS가 흐름 주도" vs "Rust `import/`가 상태머신 소유". Rust는 TS의 LLM 어댑터를 직접 호출할 수 없고(IPC는 TS→Rust 단방향), `llm_processing` 단계가 TS에서 일어나므로 "Rust가 루프 소유 + TS 어댑터 위임"은 그대로는 구현 불가.

## 결정

**TS 서비스층(`useImportStore`)이 ImportJob 상태머신 시퀀싱을 소유**한다(option A). 각 상태 전이에서 Rust의 원자적 IPC command(`extract_pdf_text`·`save_source`·`create_note`·`save_wiki_page`·`save_relations`)와 OpenAI 어댑터를 호출한다. Rust `import/`는 각 단계 **실행**(파싱·저장 등 파일 I/O)을 담당하되 시퀀싱 트리거는 소유하지 않는다. 상태는 `config/import-jobs.json`에 영속화해 재실행 시 마지막 상태·`errorMessage`를 복원한다.

## 결과

- (+) LLM 단계가 TS에 있는 현실과 정합, 재진입 경계 불필요.
- (+) Inbox UI가 store에서 실시간 상태를 직접 관찰.
- 문서 동기화: `architecture.md`·CLAUDE.md·`import-pipeline.md`·`pdf-extraction.md`의 "import/가 상태머신 소유" 표현을 본 결정(TS 주도)에 맞춰 정합화 완료.
- 상태 전이 다이어그램: [import-job-states.md](../20-backend/import-job-states.md).

## 대안

- (B) Rust `import/`가 상태머신 소유 + Tauri 이벤트로 상태 방출, LLM 단계만 TS로 재진입: 재진입 경계가 복잡하고 단방향 IPC와 상충 → 기각.
