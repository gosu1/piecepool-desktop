// 출처 페이지 — ADR-0002 결정 6. 볼트 밖에서 들어온 소스의 추출 전문을 `sources/@원본.md` 로 남긴다.
//
// 코드가 조립하고 AI 는 부르지 않는다. 전문을 보존하기로 했으므로 판단할 것이 없다.
// PDF 는 `## N페이지` 헤딩으로 나눈다 — 기록 줄의 `[[@원본#3페이지]]` 가 그 자리로 간다.

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { hash8Bytes, localDate } from "./vault.ts";

export type SourceFile = {
  /** 볼트 기준 상대경로. `sources/DETR (2020).pdf` 또는 `.piecepool/sessions/<id>.md` */
  path: string;
  /** 확장자를 뗀 파일명. 출처 페이지 이름은 `@` + 이것. 세션은 `@session-<id>`. */
  name: string;
  /** 세션 로그인가. 로그는 `## N턴 (사용자)` · `## N턴 (AI)` 헤딩으로 나뉜다. */
  session?: true;
};

const SOURCE_EXT = new Set([".pdf", ".txt", ".md"]);
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * `sources/` 안의 원본 파일과 `.piecepool/sessions/` 의 세션 로그. 출처 페이지(`@*.md`)와 숨김 파일은 뺀다.
 * 세션 로그는 수확(상위 §8.1)의 입력이다 — 대화 로그를 자료 하나로 보고 같은 파이프라인을 탄다.
 */
export async function scanSources(root: string): Promise<SourceFile[]> {
  const out: SourceFile[] = [];
  const list = async (dir: string) => {
    try {
      return await readdir(join(root, dir), { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const e of await list("sources")) {
    if (!e.isFile() || e.name.startsWith(".") || e.name.startsWith("@")) continue;
    if (!SOURCE_EXT.has(extname(e.name))) continue;
    out.push({ path: `sources/${e.name}`, name: basename(e.name, extname(e.name)) });
  }
  for (const e of await list(".piecepool/sessions")) {
    if (!e.isFile() || extname(e.name) !== ".md") continue;
    const id = basename(e.name, ".md");
    out.push({ path: `.piecepool/sessions/${e.name}`, name: `session-${id}`, session: true });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * 세션 로그를 턴으로 나눈다. 형식은 B 가 정하되, 이 데모는 `## N턴 (사용자)` · `## N턴 (AI)`
 * 헤딩이 이미 있는 로그를 받는다. 헤딩이 곧 앵커이고, `(AI)` 가 붙은 턴에서 찾은 quote 는
 * 기록 줄에 `(AI)` 표시가 붙는다 (상위 §8.2 의 꼬리표).
 */
export function isAiTurn(anchor: string | null): boolean {
  return !!anchor && /\(AI\)\s*$/.test(anchor);
}

/** 입력 벽 4·5·6 — 크기, 빈 파일, UTF-8. 통과하면 null, 아니면 이유. */
export async function inputWall(root: string, path: string): Promise<string | null> {
  const st = await stat(join(root, path));
  if (st.size > MAX_BYTES) return `50MB 초과 (${(st.size / 1024 / 1024).toFixed(0)}MB)`;
  if (st.size === 0) return "빈 파일";
  if (extname(path) !== ".pdf") {
    const buf = await readFile(join(root, path));
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch {
      // 자동 변환하지 않는다. 잘못 감지하면 깨진 글자가 위키에 들어간다 — 스킵보다 나쁘다.
      return "UTF-8 이 아님";
    }
  }
  return null;
}

/** PDF 메타데이터의 `D:20200529002147Z` → `2020-05-29`. */
function pdfDate(v: unknown): string | null {
  const m = typeof v === "string" ? /^D:(\d{4})(\d{2})(\d{2})/.exec(v) : null;
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export type Extracted = {
  /** 페이지별 텍스트. PDF 가 아니면 원문 하나. */
  pages: string[];
  /** 내부 메타데이터의 작성일. 결정 8 폴백의 두 번째 단계. */
  metaDate: string | null;
};

/** pdfjs legacy 빌드로 페이지마다 텍스트를 뽑는다. CMap 자산은 한글 PDF 에 필수다. */
export async function extractPdf(file: string): Promise<Extracted> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const base = pathToFileURL(join(process.cwd(), "node_modules/pdfjs-dist/")).href;
  const doc = await getDocument({
    data: new Uint8Array(await readFile(file)),
    cMapUrl: base + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: base + "standard_fonts/",
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
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
  }
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  return { pages, metaDate: pdfDate(info.CreationDate) ?? pdfDate(info.ModDate) };
}

export async function extract(root: string, src: SourceFile): Promise<Extracted> {
  const full = join(root, src.path);
  if (extname(src.path) === ".pdf") return extractPdf(full);
  // 볼트 밖 .md/.txt 와 세션 로그 — 원문의 헤딩을 그대로 살린다. 페이지 개념이 없다.
  const raw = (await readFile(full, "utf8")).trim();
  // 세션 로그의 프론트매터(date 등)는 본문이 아니다.
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const date = m ? (/^date:\s*(\d{4}-\d{2}-\d{2})/m.exec(m[1])?.[1] ?? null) : null;
  return { pages: [m ? raw.slice(m[0].length).trim() : raw], metaDate: date };
}

export type SourcePageInput = {
  src: SourceFile;
  rawHash: string;
  date: string | null;
  today: string;
  extracted: Extracted;
};

/** 출처 페이지 마크다운. 프론트매터 5필드(type · raw · raw_hash · date · created)는 코드만 쓴다. */
export function buildSourcePage(input: SourcePageInput): string {
  const { src, rawHash, date, today, extracted } = input;
  const out = ["---", "type: source", `raw: "[[${src.path}]]"`, `raw_hash: ${rawHash}`];
  if (date) out.push(`date: ${date}`);
  out.push(`created: ${today}`, "---", "", `# ${src.name}`, "");
  // PDF 는 임베드로 원본을 보여준다. 세션 로그와 .md 는 전문이 곧 아래에 있으므로 경로만 적는다.
  out.push(extname(src.path) === ".pdf" ? `![[${src.path}]]` : `원본: \`${src.path}\``);
  if (extname(src.path) === ".pdf") {
    extracted.pages.forEach((text, i) => {
      out.push("", `## ${i + 1}페이지`, "", text);
    });
  } else {
    out.push("", extracted.pages[0]);
  }
  out.push("");
  return out.join("\n");
}

/** 이미 있는 출처 페이지의 raw_hash. 없으면 null. 입력 벽 7(중복)의 기준. */
export async function readRawHash(root: string, src: SourceFile): Promise<string | null> {
  try {
    const raw = await readFile(join(root, "sources", `@${src.name}.md`), "utf8");
    return /^raw_hash:\s*([0-9a-f]{8})/m.exec(raw)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** 원본 파일의 지문. sha256 앞 8자리 — `hashes` 와 같은 규칙. */
export async function rawHashOf(root: string, src: SourceFile): Promise<string> {
  return hash8Bytes(await readFile(join(root, src.path)));
}

/** 결정 8 — 파일명 패턴 → 내부 메타데이터 → 수정 시각. 연도만 있는 `(2017)` 은 안 쓴다. */
export async function sourceDate(
  root: string,
  src: SourceFile,
  meta: string | null,
): Promise<string> {
  const m =
    /(20\d{2})[-._](\d{2})[-._](\d{2})/.exec(src.name) ?? /(20\d{2})(\d{2})(\d{2})/.exec(src.name);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (meta) return meta;
  return localDate((await stat(join(root, src.path))).mtime);
}
