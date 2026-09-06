> **상태: 대체됨.** 구 레포(Tauri+Rust)의 ADR 원문이다. 근거 보존용이며
> 새 번호 체계(`docs/adr/`) 밖에 있다. 재구축 결정은 `docs/adr/0001-*.md` 참조.

# ADR-0003: OCR — vision LLM 단일 경로

- 상태: 채택 (Accepted)
- 일자: 2026-06-22
- 관련: [ocr-client](../40-frontend/ocr-client.md) · [scope-mvp](../00-overview/scope-mvp.md)

## 배경

이미지/필기/스크린샷을 텍스트로 바꾸는 OCR이 MVP 범위다. Tesseract.js·Apple Vision·Google Vision·Mathpix 등 별도 엔진은 오프라인 제약·플랫폼 분기·정확도 편차 비용이 크다.

## 결정

별도 OCR 엔진을 두지 않고 **vision-capable LLM(GPT vision) 호출** 단일 경로로 처리한다. 이미지 → base64 → vision 호출 → archive 3-블록([텍스트 그대로] / [사용자 설명] / [그림 설명 — AI 해석])으로 저장. 원본 이미지는 그대로 보존한다.

## 결과

- (+) 파이프라인이 LLM 경로로 통일, 별도 의존성 없음.
- (+) 한국어·수식·판서 등 다양한 입력에 유연.
- (−) 네트워크·키 필요(오프라인 OCR 불가), 품질은 사람 검증 필요.

## 대안

- Apple Vision(네이티브): 플랫폼 종속·수식 인식 약함으로 post-MVP 후보로만 기록.
- Mathpix/Google Vision: 외부 의존·비용으로 기각.
