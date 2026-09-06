> **상태: 대체됨.** 구 레포(Tauri+Rust)의 ADR 원문이다. 근거 보존용이며
> 새 번호 체계(`docs/adr/`) 밖에 있다. 재구축 결정은 `docs/adr/0001-*.md` 참조.

# ADR-0010: PDF 텍스트 추출 — Rust `pdf-extract` + pdf.js 폴백 (ADR-0005 대체)

- 상태: 채택 (Accepted)
- 일자: 2026-07-16
- 대체: [ADR-0005](0005-pdf-extract-crate.md) (PDF 텍스트 추출 = `pdf-extract` 0.10.0 단독)
- 관련: [pdf-extraction](../20-backend/pdf-extraction.md) · [ADR-0003](0003-ocr-vision-llm.md) · [wikilink-embed](../10-contracts/wikilink-embed.md)

## 배경

[ADR-0005](0005-pdf-extract-crate.md)는 PDF→텍스트를 Rust `pdf-extract` 0.10.0 **단독**으로 확정하고, 대안인 pdf.js 프론트 파싱을 *"백엔드 경계 위반"* 으로 기각했다. 그 결정은 `pdf-extract`가 실제로 어떤 인코딩을 다루는지 측정하지 않은 상태에서 내려졌다.

측정 결과, `pdf-extract` 0.10.0(및 0.12.0)은 CID 폰트의 predefined CMap 중 **`Identity-H`/`Identity-V` 외 전부를 지원하지 않으며, `Err`가 아니라 `panic!`으로 종료**한다([lib.rs:983](https://docs.rs/crate/pdf-extract/0.10.0) `panic!("unsupported encoding {}", name)`). 한국 학술지가 흔히 쓰는 `UniKS-UTF16-H`가 여기 걸린다.

사용자 실제 PDF 14개 스캔: **12 OK / 2 ERR**. 실패 2개는 둘 다 한글 학술 논문이었고, 같은 `CV_*` 시리즈여도 파일마다 인코딩이 갈려 사용자가 예측할 수 없었다. 한글 학습노트가 이 앱의 핵심 입력이므로 14%는 무시할 예외가 아니다.

같은 2개 파일을 pdf.js `getTextContent()`로 추출하면 **원문과 일치하는 한글 텍스트가 완전히 나온다**(실측 5,765자·한글 1,401자). 이유: 이 PDF들은 `ToUnicode`를 내장하고 있고 pdf.js는 그것으로 매핑하지만, `pdf-extract`는 `Identity-H`가 아니면 그 경로를 시도조차 않는다. pdf.js·CMap 자산은 이미 앱에 번들되어 있다(PDF 미리보기 렌더링용, ADR-0005도 렌더링은 프론트 몫으로 인정).

## 결정

PDF→텍스트를 **2단계**로 한다:

1. **1차: Rust `pdf-extract` 0.10.0** — 기존 경로 유지. 빠르고 대다수 PDF(`Identity-H`)를 처리.
2. **2차 폴백: 프론트 pdf.js** — 1차가 실패(인코딩 panic 등)하거나 텍스트를 못 뽑으면, 프론트가 원본 bytes(`read_file_bytes`)를 pdf.js로 파싱해 동일한 `PdfExtractResult` 형태로 만든다.

폴백은 `src/lib/pdfText.ts`의 `extractPdfTextWithFallback(space, file)` 한 함수에 격리한다. 반환 타입·page 1-indexing·빈 페이지 `""` 보존은 백엔드 규약과 동일하므로 하류 코드는 무변경. 둘 다 텍스트가 없으면(스캔본) 사용자에게 안내하고 OCR 경로([ADR-0003](0003-ocr-vision-llm.md))로 남긴다.

Rust `pdf/` 모듈은 `pdf-extract`의 내부 panic을 `catch_unwind`로 삼켜 `AppError`로 변환한다 — 폴백에 도달하기 전에 앱이 죽지 않게 하는 전제.

## 결과

- (+) 한글 CID PDF(predefined CMap) 텍스트 추출 가능 — 실패율 14% → 0%(측정 표본 기준).
- (+) 새 의존성 0개 — pdf.js·CMap 자산은 렌더링용으로 이미 번들.
- (+) 1차 Rust 경로가 대다수를 빠르게 처리, 폴백은 실패 시에만 원본을 프론트로 읽어 비용 최소.
- (−) "PDF→텍스트는 Rust 전담"이라는 ADR-0005의 단순한 경계가 깨진다 — 텍스트 추출 책임이 Rust와 프론트에 분산. `pdf-extraction.md`·`CLAUDE.md`가 이 이중 경로를 명시하도록 갱신한다.
- (−) 폴백 경로는 원본 bytes를 프론트로 전송(base64) — 대용량 PDF에서 메모리 사용 증가. 단 뷰어가 이미 같은 방식으로 원본을 읽고 있어 새 위험은 아니다.

## 대안

- `pdf-extract` 0.12.0 업그레이드: 동일 구조로 같은 panic 재현 확인 → 기각.
- `pdfium-render`(Chrome PDF 엔진, 모든 CJK 처리): 추출을 Rust에 유지하고 경계를 지키지만, 네이티브 바이너리 번들로 빌드·패키징 복잡도와 앱 용량이 증가 → 이번 범위에서 기각(장래 재검토 가능).
- 현행 유지(크래시 방어만): panic은 막지만 한글 학술 PDF가 여전히 추출 불가 → 핵심 유스케이스 미해결로 기각.
