// 후보 추리기와 프롬프트 조립 — ADR-0002 결정 2·3.
//
// 코드가 볼트를 좁혀 후보 몇 장으로 만들고, AI 가 그중에서 고른다.

// scripts/demo/prompt.ts 를 옮겨 왔다 (2026-09-17, 4단계).

import { normalizeTitle } from "../index/links.ts";
import type { Item, WikiPage } from "./wiki.ts";

export type Candidates = {
  /** 전문을 프롬프트에 넣을 페이지. */
  related: WikiPage[];
  /** 왜 후보가 되었는지 — 로그로 설계를 확인하기 위해 남긴다. */
  why: Map<string, "글자" | "뜻" | "겹침">;
  /** 뜻 후보의 코사인 점수 (또는 겹침 후보의 BM25 점수). 임계값을 고를 때 본다. */
  score: Map<string, number>;
  /** 고칠 수 있는 절 이름 — 다시 써도 되는 것. 해시가 일치하는 것만. */
  rewritable: string[];
  /** 노트에 글자로 나오는데 페이지가 아니라 어느 페이지의 절인 주제. "환각 (추상 요약의 절)". */
  sectionTopics: string[];
  /** 링크를 걸 수 있는 이름. 제목과 별칭 전부. */
  linkable: string[];
};

/**
 * 글자 일치 — 자료에 페이지의 제목이나 별칭이 그대로 등장하는가.
 * 비용이 0 이고 확실하다. 정확한 이름이 나왔을 때 반드시 잡아야 한다.
 */
function byLiteral(note: Item, wiki: WikiPage[]): Set<string> {
  const hay = normalizeTitle(note.body);
  const hit = new Set<string>();
  for (const page of wiki) {
    const names = [page.name, ...(page.fm.aliases ?? [])];
    if (names.some((n) => n.length >= 2 && appears(hay, normalizeTitle(n)))) {
      hit.add(page.name);
    }
  }
  return hit;
}

/**
 * 한글 이름은 조사가 붙으므로 부분 일치("달리기를")가 맞다. 로마자 이름은 단어 경계가
 * 있어야 한다 — 별칭 `OS` 가 영어 논문의 "cos"·"loss" 에 걸렸다 (PDF 실측).
 */
function appears(hay: string, name: string): boolean {
  if (!/^[\x20-\x7e]+$/.test(name)) return hay.includes(name);
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}($|[^a-z0-9])`).test(hay);
}

/** 코사인 유사도. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/**
 * 모델 없는 유사도 — BM25. 페이지 본문(요약·절·기록)과 노트가 나눠 갖는 낱말을 센다.
 * 한글은 조사가 붙어 낱말 경계가 없으므로 두 글자 조각으로, 로마자·숫자는 단어로.
 *
 * 7회차 정답으로 오프라인 측정(2026-09-16, 페이지를 앞선 출처 노트 본문으로 근사): 상위 5 에서
 * 재현율 69%, 상위 8 에서 84% — 임베딩(최종 요약 기준이라 유리한 조건)의 84%(상위 5)와 같다.
 * "러닝머신·헬스장 → 달리기" 셋은 1·1·3위. 뜻을 아는 게 아니라 페이지 뒤에 쌓인 노트가
 * 그 낱말을 들고 있다. 키·한도·서버가 없다.
 */
function tokens(text: string): string[] {
  const out: string[] = [];
  const hay = normalizeTitle(text).replace(/\[\[|\]\]/g, " ");
  for (const run of hay.match(/[가-힣]+|[a-z0-9]+/g) ?? []) {
    if (!/^[가-힣]/.test(run)) out.push(run);
    else if (run.length === 1) out.push(run);
    else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}

function pageLexText(page: WikiPage): string {
  return [
    page.name,
    ...(page.fm.aliases ?? []),
    page.summary,
    ...page.sections.map((s) => `${s.heading}\n${s.content}`),
    ...page.records,
  ].join("\n");
}

/** 노트에 대한 각 페이지의 BM25 점수. k1 = 1.2 · b = 0.75 (교과서 값). */
function bm25(note: Item, wiki: WikiPage[]): Map<string, number> {
  const docs = wiki.map((p) => tokens(pageLexText(p)));
  const n = docs.length;
  const avg = docs.reduce((a, d) => a + d.length, 0) / (n || 1);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = new Set(tokens(note.body));
  const out = new Map<string, number>();
  docs.forEach((d, i) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * d.length) / avg));
    }
    out.set(wiki[i].name, score);
  });
  return out;
}

export type EmbedOpts = {
  /** 노트와 각 위키 페이지의 벡터. 없으면 뜻 유사도를 건너뛴다. */
  noteVec: number[];
  pageVecs: Map<string, number[]>;
  /** 이 값 이상만 후보로. 측정 전이므로 잠정값이다 (ADR 미결). */
  threshold: number;
  /** 상한. */
  topN: number;
};

/**
 * 후보를 추린다. 글자 일치는 무조건 포함하고, 뜻 유사도로 넓힌다.
 * ADR-0002 결정 3 — 두 방법이 서로의 빈틈을 메운다.
 */
export function pickCandidates(
  note: Item,
  wiki: WikiPage[],
  embed?: EmbedOpts,
  lexical?: { topN: number },
): Candidates {
  const why = new Map<string, "글자" | "뜻" | "겹침">();
  const score = new Map<string, number>();

  for (const name of byLiteral(note, wiki)) why.set(name, "글자");

  if (lexical) {
    const scored = [...bm25(note, wiki)]
      .filter(([, sc]) => sc > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, lexical.topN);
    for (const [name, sc] of scored) {
      score.set(name, sc);
      if (!why.has(name)) why.set(name, "겹침");
    }
  }

  if (embed) {
    const scored = wiki
      .map((p) => ({ page: p, score: cosine(embed.noteVec, embed.pageVecs.get(p.name) ?? []) }))
      .filter((x) => x.score >= embed.threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, embed.topN);
    for (const { page, score: sc } of scored) {
      score.set(page.name, sc);
      if (!why.has(page.name)) why.set(page.name, "뜻");
    }
  }

  // `나` 는 항상 후보다. '나' 에 관한 페이지들의 목차이므로 AI 가 그 존재를 알아야
  // 새 페이지를 거기 링크할 수 있다. 레퍼런스의 overview.md / Home.md 와 같은 고정 허브.
  const me = wiki.find((p) => normalizeTitle(p.name) === "나");
  if (me && !why.has(me.name)) why.set(me.name, "글자");

  const related = wiki.filter((p) => why.has(p.name));

  // 고칠 수 있는 절 — 해시가 일치하는 것만. 사용자가 고친 절은 목록에서 빠진다.
  // 페이지별로 묶어서 준다. "CNN / 핵심 개념" 처럼 한 줄로 주면 `/` 가 구분자인지
  // 절 이름의 일부인지 헷갈리고, 규칙 2 가 파일명에 `/` 를 금지하고 있어 더 혼란스럽다.
  const rewritable: string[] = [];
  for (const page of related) {
    const names = page.sections.filter((x) => x.ours && x.heading !== "요약").map((x) => x.heading);
    if (names.length) rewritable.push(`${page.name}: ${names.join(", ")}`);
  }

  // 절로 있는 주제 — 노트가 다루는 이름이 어느 페이지의 절 제목과 같으면 알린다.
  // 첫 자료가 `환각` 을 `추상 요약` 의 절로 넣으면 이후 자료 스무 장이 그 절에 쌓였다
  // (연구자 볼트 12회차). 규칙만으로는 AI 가 그 절의 존재를 눈여겨보지 않는다 — 코드가 보이게 한다.
  const hay = normalizeTitle(note.body);
  const pageNames = new Set(wiki.map((p) => normalizeTitle(p.name)));
  const sectionTopics: string[] = [];
  for (const page of wiki) {
    for (const sec of page.sections) {
      const h = sec.heading.trim();
      if (h === "요약" || h.length < 2 || pageNames.has(normalizeTitle(h))) continue;
      if (appears(hay, normalizeTitle(h))) sectionTopics.push(`${h} (${page.name}의 절)`);
    }
  }

  // 링크 후보 — 볼트의 모든 페이지. 후보로 추려진 것만이 아니다.
  const linkable: string[] = [];
  for (const page of wiki) {
    const aliases = page.fm.aliases ?? [];
    linkable.push(aliases.length ? `${page.name} (별칭: ${aliases.join(", ")})` : page.name);
  }

  return { related, why, score, rewritable, sectionTopics, linkable };
}

/** 위키 페이지를 프롬프트에 넣을 마크다운으로. 사용자가 고친 절은 목록에서 빠지므로 표시가 필요 없다. */
function renderPage(page: WikiPage, hint?: string): string {
  const lines = [`# ${page.name}`];
  if (page.summary) lines.push("", `> ${page.summary}`);
  // 코드가 아는 것을 보이게 한다 — 예: "이 요약은 노트 40장 전 것입니다".
  if (hint) lines.push("", `(${hint})`);
  for (const s of page.sections) {
    if (s.heading === "요약") continue;
    lines.push("", `## ${s.heading}`, "", s.content);
  }
  // 기록 절은 보내지 않는다 (2026-09-17). 페이지 글자의 43~56% 가 기록이고, 86장 볼트에서
  // 호출당 입력이 1.8만 → 2.8만 토큰으로 자란 주된 이유였다. AI 가 기록을 보는 이유는
  // "같은 사실을 또 넣지 않기" 뿐인데 그것은 검문(`기록-중복`)이 코드로 막는다.
  return lines.join("\n");
}

/**
 * AI 에게 보낼 사용자 메시지.
 * 시스템 프롬프트(write.md)가 설명하는 네 블록을 그대로 만든다.
 */
export function buildUserMessage(
  note: Item,
  c: Candidates,
  part: string | null = null,
  hints: Map<string, string> = new Map(),
): string {
  const date = note.date ?? "";
  const out: string[] = [];

  out.push("<소스>");
  // part 는 긴 소스를 청크로 나눴을 때 "2/3" 처럼 붙는다. AI 가 앞뒤가 잘렸음을 알게 한다.
  out.push(
    `<context source="${note.name}"${date ? ` date="${date}"` : ""}${part ? ` part="${part}"` : ""}>`,
  );
  out.push(note.body);
  out.push("</context>");
  out.push("</소스>");
  out.push("");

  out.push("<관련 위키>");
  if (c.related.length === 0) {
    out.push("(찾지 못했습니다)");
  } else {
    for (const p of c.related) {
      out.push(renderPage(p, hints.get(p.name)));
      out.push("");
    }
  }
  out.push("</관련 위키>");
  out.push("");

  out.push("<고칠 수 있는 절>");
  out.push(c.rewritable.length ? c.rewritable.join("\n") : "(없습니다)");
  out.push("</고칠 수 있는 절>");
  out.push("");

  if (c.sectionTopics.length) {
    out.push("<절로 있는 주제>");
    out.push(c.sectionTopics.join("\n"));
    out.push("</절로 있는 주제>");
    out.push("");
  }

  out.push("<링크 후보 목록>");
  out.push(c.linkable.length ? c.linkable.join("\n") : "(볼트가 비어 있습니다)");
  out.push("</링크 후보 목록>");

  return out.join("\n");
}

/** 임베딩에 넣을 텍스트. 페이지는 제목과 요약만 — 전문을 넣으면 주제가 흐려진다. */
export function pageEmbedText(page: WikiPage): string {
  return page.summary ? `${page.name}\n${page.summary}` : page.name;
}
