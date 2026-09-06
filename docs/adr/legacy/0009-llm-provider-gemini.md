> **상태: 대체됨.** 구 레포(Tauri+Rust)의 ADR 원문이다. 근거 보존용이며
> 새 번호 체계(`docs/adr/`) 밖에 있다. 재구축 결정은 `docs/adr/0001-*.md` 참조.

# ADR-0009: LLM provider — Google Gemini 단일 (ADR-0001 대체)

- 상태: 채택 (Accepted)
- 일자: 2026-07-10
- 대체: [ADR-0001](0001-llm-provider-openai.md) (LLM provider = OpenAI 단일)
- 관련: [provider-config](../30-llm/provider-config.md) · [llm-output-schema](../10-contracts/llm-output-schema.md) · [ADR-0002](0002-single-tier-pricing.md) · [ADR-0008](0008-note-synthesis-streaming.md)

## 배경

[ADR-0001](0001-llm-provider-openai.md)은 LLM provider를 OpenAI 단일로 확정했다. 2026-07-07 커밋 `0eb930d`이 소스 전체를 Google Gemini로 교체했으나, 그 커밋 메시지는 스스로 _"테스트 갱신·문서(SSOT/ADR)는 후속 커밋"_ 이라 적었고 **그 후속 커밋은 오지 않았다.**

그 결과 저장소가 3일간 두 개의 진실을 말했다. 소스는 Gemini를 호출하는데 `README`·`CONTRIBUTING`·`.env.example`·`CLAUDE.md`는 `OPENAI_API_KEY`를 요구했다. 팀원이 문서대로 `.env`에 `OPENAI_API_KEY`를 채우면 앱은 그 값을 완전히 무시하고 키 없는 휴리스틱 폴백으로 조용히 내려갔다 — 되묻기 패널이 뜨지 않는 것이 유일한 증상이었다. 이 ADR은 전환을 사후 기록하고 드리프트를 닫는다.

## 결정

1. **LLM provider를 Google Gemini 단일**로 확정한다. 기본 모델은 `gemini-2.5-flash`(생성)와 `gemini-embedding-001`(임베딩). 키는 `GEMINI_API_KEY`.
2. **호출은 Gemini의 OpenAI 호환 엔드포인트**(`generativelanguage.googleapis.com/v1beta/openai`)의 Chat Completions(`/chat/completions`, `response_format`, `delta.content`)를 쓴다. 따라서 `src/llm/*.ts`에 남은 `openai` 식별자는 **전송 규격을 가리키며 벤더를 가리키지 않는다.**
   - ADR-0001이 쓰던 Responses API(`/responses`, `text.format`, SSE `response.*`)는 Gemini가 제공하지 않아 함께 폐기됐다.
   - 출력은 여전히 structured output(`json_schema`)으로 받아 [`LlmWikiResult`](../10-contracts/llm-output-schema.md)로 정규화한다. **계약은 무변경** — provider 교체가 계약을 건드리지 않는다는 것이 어댑터 경계(`src/llm/`)의 존재 이유다.
   - Gemini는 `strict: true`를 거부하므로 `strict: false` + 다운스트림 파싱으로 받는다.
3. **feature 3(정보 간극 메우기, label↔user)의 구조는 ADR-0001 그대로 유지**한다. 주 해결책은 Liner API(권위 출처 검색 · fact-check), 보조는 LLM의 소크라테스식 되묻기 — 그 보조 역할만 OpenAI에서 Gemini로 바뀐다.
4. **키는 두 경로로 읽는다. 이 이원화를 문서에 명시한다.**
   - 데스크톱 앱: 설정 모달 → `localStorage["gemini-key"]`. 앱은 `.env`를 읽지 않는다(웹뷰에 `process`가 없다).
   - CLI 스크립트: `.env` 또는 셸 환경변수의 `GEMINI_API_KEY`. `package.json`의 `tsx` 스크립트가 `--env-file-if-exists=.env`로 로드한다.

## 결과

- (+) 팀 전원이 [aistudio.google.com/apikey](https://aistudio.google.com/apikey)에서 무료 등급 키를 즉시 발급받아 전 기능을 돌릴 수 있다 — 대회 심사위원의 재현도 같다.
- (+) OpenAI 호환 규격이라 어댑터 골격·검증·eval 경로가 그대로 남았다. 계약(`llm-output-schema.md`) 변경 0건.
- (−) `src/llm/`에 `openai`라는 단어가 남아 벤더로 오독될 수 있다. 위 결정 2가 그 의미를 못박는다.
- (−) Responses API 전용 기능(`strict: true` 구조화 출력)을 잃었다 — 다운스트림 파싱으로 보완한다.
- 키가 없어도 앱은 죽지 않고 휴리스틱 폴백으로 동작한다(keyless 전 기능 원칙, ADR-0008과 동일).

## 대안

- **(B) OpenAI로 되돌린다**: 결제 수단이 있는 팀원만 개발·검증할 수 있고, 심사위원 재현이 막힌다 → 기각.
- **(C) provider 2종을 런타임 스위치로 둔다**: `ProviderId` 유니온과 eval 매트릭스가 2배가 된다. 단일 provider가 ADR-0001의 원래 취지(어댑터·검증·eval 경로 단일화)였고 그 취지는 여전히 유효하다 → 기각.
- **(D) Gemini 네이티브 API(`v1beta/models/*:generateContent`)를 쓴다**: OpenAI 호환 규격을 버리면 어댑터·스트리밍·임베딩 코드를 전부 다시 써야 한다. 얻는 것은 Gemini 고유 기능뿐인데 지금 쓰지 않는다 → 기각.
