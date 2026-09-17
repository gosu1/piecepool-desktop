// 쿼리 세션의 검색 — 절 단위 색인 + BM25.
//
// A(정리)의 후보 추리기와 부품이 갈라져 있다. A 는 질의가 노트 한 장이고 문서가 페이지지만,
// B 는 질의가 질문 한 줄이고 문서가 절이다. 같은 이름을 쓰지 않는 이유가 그것이다
// (설계 2026-09-17-query-session-design.md §4.0.1).
import type { NotePath, Vault } from "../../shared/types.ts";
import { readWikiPage, scanWiki, type WikiPage } from "../ingest/wiki.ts";

/**
 * 본문 폴딩. `index/links.ts` 의 `normalizeTitle` 과 목적이 다르다 —
 * 저쪽은 제목 키라 공백을 지우지만, 여기서 공백을 지우면
 * `the OS is` 가 `theosis` 가 되어 로마자 이름의 단어 경계가 사라진다.
 */
export function foldText(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

/**
 * 한글은 조사가 붙어 낱말 경계가 없으므로 글자 조각으로 자른다.
 *
 * 유니그램을 함께 내는 것이 A 와 다른 점이다. 바이그램만 쓰면 1글자 질의어가
 * 색인과 **절대** 만나지 못한다 — `잠` 은 `[잠]`, `잠들고` 는 `[잠들, 들고]` 라
 * "요즘 잠 잘 자?" 가 0건이 됐다 (2026-09-17 실측).
 * 유니그램은 거의 모든 문서에 나와 IDF 가 알아서 점수를 죽인다.
 */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const run of foldText(text).match(/[가-힣]+|[a-z0-9]+/g) ?? []) {
    if (!/^[가-힣]/.test(run)) {
      out.push(run);
      continue;
    }
    for (const ch of run) out.push(ch);
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

/** 색인의 한 칸. `text` 는 돌려줄 표시용이고, 색인에 넣는 텍스트는 따로 만든다. */
export interface Section {
  path: NotePath;
  page: string;
  heading: string;
  text: string;
}

export interface Hit {
  path: NotePath;
  heading: string;
  score: number;
  text: string;
}

export interface WikiIndex {
  sections: Section[];
  /** 절마다 낱말 → 횟수. */
  tf: Map<string, number>[];
  /** 낱말 → 그 낱말이 나온 절 수. */
  df: Map<string, number>;
  lens: number[];
  avgLen: number;
}

// 교과서 값. 측정 없이 바꾸지 않는다.
const K1 = 1.2;
const B = 0.75;
const LIMIT = 5;
const PER_PAGE = 2;
const SNIPPET = 600;

/**
 * 색인에 넣는 텍스트 — 페이지 이름과 별칭을 **모든 절에** 넣는다.
 *
 * `무릎 통증.md` 의 `증상` 절 본문에는 "무릎" 이 없다. 이름이 파일명에만 있기 때문이다.
 * 절 본문만 색인하면 `무릎` 질의가 그 절을 놓친다. 이 한 줄이 A 의 글자 일치(`byLiteral`)를
 * 따로 옮기지 않아도 되게 만든다.
 */
function indexText(page: WikiPage, heading: string, content: string): string {
  return [page.name, ...(page.fm.aliases ?? []), heading, content].join("\n");
}

/** 페이지들을 절 단위로 펴서 색인한다. df·평균 길이를 여기서 한 번만 센다. */
export function indexPages(pages: WikiPage[]): WikiIndex {
  const sections: Section[] = [];
  const raw: string[] = [];

  for (const p of pages) {
    if (p.summary) {
      sections.push({ path: p.path, page: p.name, heading: "요약", text: p.summary });
      raw.push(indexText(p, "요약", p.summary));
    }
    for (const s of p.sections) {
      if (s.heading === "요약") continue; // readWikiPage 가 요약을 절에도 넣는다
      sections.push({ path: p.path, page: p.name, heading: s.heading, text: s.content });
      raw.push(indexText(p, s.heading, s.content));
    }
  }

  const docs = raw.map(tokens);
  const tf = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of d) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const lens = docs.map((d) => d.length);
  const avgLen = lens.length === 0 ? 0 : lens.reduce((a, n) => a + n, 0) / lens.length;

  return { sections, tf, df, lens, avgLen };
}

/** 볼트의 `wiki/` 를 읽어 색인한다. 세션 시작 때 한 번 부른다. */
export async function buildIndex(v: Vault): Promise<WikiIndex> {
  const pages: WikiPage[] = [];
  for (const p of await scanWiki(v)) pages.push(await readWikiPage(v, p));
  return indexPages(pages);
}

function idf(ix: WikiIndex, term: string): number {
  const n = ix.sections.length;
  const d = ix.df.get(term) ?? 0;
  return Math.log(1 + (n - d + 0.5) / (d + 0.5));
}

/**
 * BM25. 상위 `limit` 절을 돌려주되 한 페이지가 `PER_PAGE` 를 넘지 않는다 —
 * 한 페이지가 목록을 다 먹으면 다른 후보가 보이지 않는다.
 */
export function search(ix: WikiIndex, query: string, o?: { limit?: number }): Hit[] {
  if (ix.sections.length === 0) return [];
  const q = new Set(tokens(query));

  const scored: Hit[] = [];
  ix.sections.forEach((sec, i) => {
    let score = 0;
    for (const t of q) {
      const f = ix.tf[i].get(t);
      if (f === undefined) continue;
      const norm = K1 * (1 - B + (B * ix.lens[i]) / (ix.avgLen || 1));
      score += idf(ix, t) * ((f * (K1 + 1)) / (f + norm));
    }
    if (score > 0) {
      scored.push({
        path: sec.path,
        heading: sec.heading,
        score,
        text: sec.text.length > SNIPPET ? sec.text.slice(0, SNIPPET) : sec.text,
      });
    }
  });

  scored.sort((a, b) => b.score - a.score);

  const perPage = new Map<NotePath, number>();
  const out: Hit[] = [];
  for (const h of scored) {
    const n = perPage.get(h.path) ?? 0;
    if (n >= PER_PAGE) continue;
    perPage.set(h.path, n + 1);
    out.push(h);
    if (out.length >= (o?.limit ?? LIMIT)) break;
  }
  return out;
}
