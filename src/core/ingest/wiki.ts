// 위키 읽기 — 노트 스캔, 프론트매터 파싱, 위키 페이지의 절과 해시 (ADR-0002 결정 5).
// scripts/demo/vault.ts 를 옮겨 왔다 (2026-09-17, 4단계).

import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import type { Fm, NotePath, Vault } from "../../shared/types.ts";
import type { TreeNode } from "../../shared/ipc.ts";
import { normalizeTitle } from "../index/links.ts";
import { readTree } from "../vault/tree.ts";

/**
 * 정리할 항목 하나 — 볼트 노트이거나 `sources/` 의 원본이거나 세션 로그다.
 * shared 의 Note(화면용)와 다르다: AI 에게 넘기고 quote 를 대조할 본문과 날짜만 있다.
 */
export type Item = {
  /** sync_state 의 키. 볼트 기준 상대경로. */
  key: NotePath;
  /** 기록 줄의 링크 이름. 노트는 파일명, 원본은 `@파일명`. */
  name: string;
  /** AI 에게 넘기고 quote 를 대조할 본문. */
  body: string;
  /** ADR-0002 결정 8 의 폴백으로 얻은 날짜. */
  date: string | null;
  /** 원본의 sha256 앞 8자리. sync_state 의 기준. */
  hash: string;
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
  path: NotePath;
  name: string;
  fm: Fm;
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

/** 원본 파일(PDF 등)의 지문. 같은 규칙, 입력만 바이트. */
export function hash8Bytes(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex").slice(0, 8);
}

/**
 * 입력 벽 1~3 — 숨김 폴더와 .md 아닌 파일은 readTree 가 이미 거른다.
 * 순회 규칙을 여기 또 짜면 두 벌이 조용히 갈라진다 (index/scan.ts 와 같은 이유).
 */
async function allMarkdown(v: Vault): Promise<NotePath[]> {
  const out: NotePath[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.kind === "file") out.push(n.path);
      else if (n.children) walk(n.children);
    }
  };
  walk(await readTree(v));
  return out;
}

/**
 * 프론트매터를 갈라낸다. 값은 문자열로만 읽는다 — 위키 페이지는 우리가 쓴 것이라 그것으로 충분하다.
 * 사용자 노트의 프론트매터를 되쓰는 일은 여기 없다 (그것은 vault/frontmatter.parse 의 몫).
 */
export function splitFrontmatter(raw: string): { fm: Record<string, string>; body: string } {
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

/** 볼트 노트 한 장을 정리 항목으로 읽는다. */
export async function readItem(v: Vault, path: NotePath): Promise<Item> {
  const full = join(v.root, path);
  const raw = await readFile(full, "utf8");
  const { fm, body } = splitFrontmatter(raw);
  const st = await stat(full);
  return {
    key: path,
    name: basename(path, extname(path)),
    body: body.trim(),
    hash: hash8(raw),
    date: pickDate(fm, basename(path), st.mtime),
  };
}

/** 볼트 안의 사용자 노트 전부. wiki/ 와 sources/ 는 제외한다 — 그것은 우리가 만든 것이다. */
export async function scanNotes(v: Vault): Promise<NotePath[]> {
  return (await allMarkdown(v))
    .filter((p) => !p.startsWith("wiki/") && !p.startsWith("sources/"))
    .sort();
}

/** wiki/ 의 페이지 경로. */
export async function scanWiki(v: Vault): Promise<NotePath[]> {
  return (await allMarkdown(v)).filter((p) => p.startsWith("wiki/")).sort();
}

/** 위키 전부를 정규화한 이름으로. 같은 이름이 둘이면 뒤가 이긴다 — 동명 보고는 lint 의 몫이다. */
export async function loadWiki(v: Vault): Promise<Map<string, WikiPage>> {
  const map = new Map<string, WikiPage>();
  for (const p of await scanWiki(v)) {
    const page = await readWikiPage(v, p);
    map.set(normalizeTitle(page.name), page);
  }
  return map;
}

/** 위키 페이지를 절 단위로 가른다. hashes 와 대조해 각 절이 우리 것인지 판정한다. */
export async function readWikiPage(v: Vault, path: NotePath): Promise<WikiPage> {
  const raw = await readFile(join(v.root, path), "utf8");
  const { fm: rawFm, body } = splitFrontmatter(raw);

  const fm: Fm = {
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
