// FROZEN: 파일 전체 (0단계 설계 §8, 상위 §7.1)
import { readFile } from "node:fs/promises";
import type { OnProgress } from "../../shared/types.ts";
import { PiecePoolError } from "../errors.ts";

type PdfDocument = Awaited<
  ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs").getDocument>["promise"]
>;

/**
 * CMap 과 표준 글꼴 자산은 pdfjs-dist 패키지 안에 있다. 패키지 위치를 모듈 해석기에게 묻는다 —
 * cwd 기준으로 잡으면 앱이 다른 폴더에서 떠도 깨진다. 패키징 때 자산을 옮기면 여기만 고친다
 * (core/assets.ts 와 같은 이유).
 */
async function open(file: string): Promise<PdfDocument> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const base = new URL("../../../", import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href;
  return await getDocument({
    data: new Uint8Array(await readFile(file)),
    cMapUrl: base + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: base + "standard_fonts/",
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
}

/**
 * pdfjs-dist 의 legacy 빌드를 순수 Node 에서 단독 추출기로 쓴다.
 * 기본 빌드는 브라우저 전용 API 를 전제하므로 Node 에서 돌지 않는다.
 *
 * CMap 자산을 함께 번들하고 cMapUrl/cMapPacked 를 지정해야 한다 —
 * 한글 CID PDF(UniKS-UTF16-H 등)가 여기 달려 있고, 빠뜨리면
 * 실측 14개 중 2개가 실패하던 상태로 돌아간다.
 *
 * page 는 1-indexed, 빈 페이지는 "" 로 보존한다 — ![[x.pdf#page=N]] 이 여기 의존한다.
 * 텍스트가 0자면 스캔본·손글씨로 보고 parse_failed 로 알린다. OCR 은 범위 밖이다.
 */
export async function extractPdfText(
  file: string,
  o?: { onProgress?: OnProgress },
): Promise<string[]> {
  const doc = await open(file);
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(
      tc.items
        .map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : ""))
        .join("")
        .trim(),
    );
    o?.onProgress?.({ step: "pdf", detail: `${i}/${doc.numPages}쪽` });
  }
  if (pages.every((p) => p.length === 0)) {
    throw new PiecePoolError("parse_failed", `텍스트가 0자다 (스캔본?): ${file}`);
  }
  return pages;
}

/** 내부 메타데이터의 작성일 `D:20200529002147Z` → `2020-05-29`. 결정 8 폴백의 두 번째 단계. */
export async function pdfMetaDate(file: string): Promise<string | null> {
  const doc = await open(file);
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => {
    const m = typeof v === "string" ? /^D:(\d{4})(\d{2})(\d{2})/.exec(v) : null;
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };
  return pick(info.CreationDate) ?? pick(info.ModDate);
}
