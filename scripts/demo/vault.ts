// 볼트 읽기 — 노트 스캔, 프론트매터 파싱, 위키 페이지의 절과 해시.
//
// 데모용이다. ADR-0002 가 승인되면 src/core/vault/ 로 옮긴다.
// src/shared/types.ts 의 Fm 은 아직 4필드(동결)이므로 여기서 자체 타입을 쓴다.

import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, basename, extname } from "node:path";

/** 위키 페이지의 프론트매터. ADR-0002 결정 5. */
export type Fm5 = {
  aliases?: string[];
  sources?: string[];
  created?: string;
  compiledAt?: string;
  hashes?: Record<string, string>;
};

export type Note = {
  /** 볼트 루트 기준 상대경로. POSIX 구분자. */
  path: string;
  /** 확장자를 뗀 파일명. 링크 해석의 기준. */
  name: string;
  /** 프론트매터를 제외한 본문. */
  body: string;
  /** 사용자가 쓴 프론트매터. 우리는 건드리지 않는다. */
  userFm: Record<string, string>;
  /** 파일 전체 내용의 sha256 앞 8자리. sync_state 의 기준. */
  hash: string;
  /** ADR-0002 결정 8 의 폴백으로 얻은 날짜. */
  date: string | null;
};

export type WikiSection = {
  heading: string;
  content: string;
  /** 이 절의 현재 내용 해시. */
  hash: string;
  /**
   * 프론트매터의 hashes 와 일치하는가.
   * true  = 우리가 쓴 그대로 → 다시 써도 된다
   * false = 사용자가 고쳤거나 지문이 없다 → 건드리지 않는다
   */
  ours: boolean;
};

export type WikiPage = {
  path: string;
  name: string;
  fm: Fm5;
  /** 제목 바로 아래 blockquote. */
  summary: string;
  /** `## 기록` 을 제외한 H2 절들. */
  sections: WikiSection[];
  /** 기록 절의 줄들. */
  records: string[];
  recordsOurs: boolean;
};

/**
 * 지역 시간대의 YYYY-MM-DD. `toISOString()` 은 UTC 라서 한국 시간 자정부터 오전 9시
 * 사이에 쓴 노트가 전날 날짜를 받는다 (2026-09-15 새벽 실측: 14일로 나옴).
 */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** sha256 앞 8자리. ADR-0002 결정 5. */
export function hash8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

/**
 * 제목 정규화. CLAUDE.md §4 — 이 함수 하나만 쓴다.
 * NFC 는 macOS 옵시디언이 파일명을 NFD 로 저장하는 경우를 잡는다.
 */
export function normalizeTitle(s: string): string {
  return s.normalize("NFC").toLowerCase().trim();
}

const SKIP_DIRS = new Set([".obsidian", ".git", ".piecepool", ".trash"]);
const TEXT_EXT = new Set([".md", ".txt"]);

/** 입력 벽 1~3. 숨김 폴더와 처리 불가 확장자를 걸러낸다. */
async function walk(root: string, dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, out);
    } else if (TEXT_EXT.has(extname(entry.name))) {
      out.push(relative(root, full).split("\\").join("/"));
    }
  }
}

/** 프론트매터를 갈라낸다. 값은 문자열로만 읽는다 — 데모에서는 그것으로 충분하다. */
function splitFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { fm: {}, body: raw };
  const fm: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: raw.slice(m[0].length) };
}

const DATE_PATTERNS: { re: RegExp; take: (m: RegExpExecArray) => string }[] = [
  // YYYY-MM-DD · YYYY.MM.DD · YYYY_MM_DD
  { re: /(20\d{2})[-._](\d{2})[-._](\d{2})/, take: (m) => `${m[1]}-${m[2]}-${m[3]}` },
  // YYYYMMDD
  { re: /(20\d{2})(\d{2})(\d{2})/, take: (m) => `${m[1]}-${m[2]}-${m[3]}` },
];

/**
 * ADR-0002 결정 8 의 날짜 폴백.
 *   프론트매터 → 파일명의 명확한 패턴 → 파일 수정 시각 → null
 * MMDD 단독과 YYYY 단독은 쓰지 않는다. 연도를 모르거나 날짜가 아니다.
 */
function pickDate(fm: Record<string, string>, fileName: string, mtime: Date): string | null {
  for (const key of ["created", "date"]) {
    const v = fm[key];
    if (v && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  for (const { re, take } of DATE_PATTERNS) {
    const m = re.exec(fileName);
    if (m) return take(m);
  }
  return localDate(mtime);
}

export async function readNote(root: string, path: string): Promise<Note> {
  const full = join(root, path);
  const raw = await readFile(full, "utf8");
  const { fm, body } = splitFrontmatter(raw);
  const st = await stat(full);
  const name = basename(path, extname(path));
  return {
    path,
    name,
    body: body.trim(),
    userFm: fm,
    hash: hash8(raw),
    date: pickDate(fm, basename(path), st.mtime),
  };
}

/** 볼트 안의 사용자 노트 전부. wiki/ 는 제외한다 — 그것은 우리가 만든 것이다. */
export async function scanNotes(root: string): Promise<string[]> {
  const paths: string[] = [];
  await walk(root, root, paths);
  return paths.filter((p) => !p.startsWith("wiki/") && !p.startsWith("sources/")).sort();
}

/** wiki/ 의 페이지 경로. */
export async function scanWiki(root: string): Promise<string[]> {
  const paths: string[] = [];
  const wikiDir = join(root, "wiki");
  try {
    await walk(root, wikiDir, paths);
  } catch {
    return [];
  }
  return paths.filter((p) => extname(p) === ".md").sort();
}

/** 위키 페이지를 절 단위로 가른다. hashes 와 대조해 각 절이 우리 것인지 판정한다. */
export async function readWikiPage(root: string, path: string): Promise<WikiPage> {
  const raw = await readFile(join(root, path), "utf8");
  const { fm: rawFm, body } = splitFrontmatter(raw);

  const fm: Fm5 = {
    aliases: parseList(rawFm.aliases),
    sources: parseList(rawFm.sources),
    created: rawFm.created,
    compiledAt: rawFm.compiledAt,
    hashes: parseHashes(raw),
  };

  // 첫 blockquote = 요약. ADR-0002 결정 5 의 페이지 구조.
  const sm = /^>\s?(.*)$/m.exec(body);
  const summary = sm ? sm[1].trim() : "";

  const sections: WikiSection[] = [];
  let records: string[] = [];
  let recordsOurs = false;

  // H2 로 자른다. H3 이하는 부모 H2 의 내용에 포함된다.
  const parts = body.split(/^## /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf("\n");
    const heading = (nl < 0 ? part : part.slice(0, nl)).trim();
    const content = (nl < 0 ? "" : part.slice(nl + 1)).trim();
    const h = hash8(content);
    const stored = fm.hashes?.[heading];
    if (heading === "기록") {
      records = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("- "));
      recordsOurs = stored === h;
    } else {
      sections.push({ heading, content, hash: h, ours: stored === h });
    }
  }

  // 요약도 절처럼 판정한다.
  if (summary) {
    const stored = fm.hashes?.["요약"];
    sections.unshift({
      heading: "요약",
      content: summary,
      hash: hash8(summary),
      ours: stored === hash8(summary),
    });
  }

  return {
    path,
    name: basename(path, ".md"),
    fm,
    summary,
    sections,
    records,
    recordsOurs,
  };
}

function parseList(v: string | undefined): string[] {
  if (!v) return [];
  const inner = /^\[(.*)\]$/.exec(v.trim());
  const body = inner ? inner[1] : v;
  return body
    .split(",")
    .map((s) =>
      s
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/^\[\[|\]\]$/g, ""),
    )
    .filter(Boolean);
}

/** hashes 는 중첩 블록이라 별도로 읽는다. */
function parseHashes(raw: string): Record<string, string> {
  const m = /^hashes:\r?\n((?:[ \t]+.*\r?\n?)*)/m.exec(raw);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^[ \t]+(.+?):\s*([0-9a-f]{8})\s*$/.exec(line);
    if (kv) out[kv[1].trim()] = kv[2];
  }
  return out;
}
