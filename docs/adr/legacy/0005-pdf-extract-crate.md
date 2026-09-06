> **상태: 대체됨.** 구 레포(Tauri+Rust)의 ADR 원문이다. 근거 보존용이며
> 새 번호 체계(`docs/adr/`) 밖에 있다. 재구축 결정은 `docs/adr/0001-*.md` 참조.

# ADR-0005: PDF 텍스트 추출 — pdf-extract 0.10.0

- 상태: 대체됨 (Superseded) → [ADR-0010](0010-pdf-text-extraction-pdfjs-fallback.md)
- 일자: 2026-07-01
- 관련: [pdf-extraction](../20-backend/pdf-extraction.md) · [import-pipeline](../20-backend/import-pipeline.md)

> **대체 사유**: `pdf-extract`가 `Identity-H`/`Identity-V` 외 predefined CMap(예: 한글 `UniKS-UTF16-H`)을 `panic!`으로 거부함이 측정으로 드러났다(사용자 PDF 14개 중 2개 실패, 둘 다 한글 학술 논문). 아래에서 "백엔드 경계 위반"으로 기각한 pdf.js 폴백을 [ADR-0010](0010-pdf-text-extraction-pdfjs-fallback.md)이 재도입한다.

## 배경

`parsing` 단계에서 PDF를 페이지 단위 텍스트로 변환해야 한다(`#page=N` 범위 검증·`SourceRef.page` 정합을 위해 페이지 인덱스 보존 필수). 후보: `pdfium`(네이티브 바인딩), `pdf-extract`(순수 Rust), `pdf.js`(프론트), 외부 CLI.

## 결정

Rust `pdf/` 모듈에서 **`pdf-extract` 0.10.0**을 사용한다. 페이지별 추출 API로 `PdfExtractResult { page_count, pages: [{ page, text }] }`를 반환하고, 빈 페이지는 `""`로 보존(인덱스 압축 금지). `#page=N` 범위 검증은 프론트 책임.

## 결과

- (+) 순수 Rust — 네이티브 바인딩·외부 프로세스 없음, 빌드 단순.
- (−) 스캔 PDF(이미지)는 텍스트 0 → OCR 경로([ADR-0003](0003-ocr-vision-llm.md))로 보완.

## 대안

- pdfium: 네이티브 의존성·번들 크기로 기각.
- pdf.js: 프론트 파싱은 백엔드 경계 위반으로 기각.
