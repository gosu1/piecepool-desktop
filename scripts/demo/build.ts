// 검문과 빌더 — ADR-0002 결정 2·4·5.
//
// 검문이 빌더보다 앞이다. JSON 상태에서 걸러야 배열 항목 제거로 끝난다.
// 매칭과 잠금 확인도 검문이 함께 한다 — 나뉘면 확인한 절과 쓰는 절이 달라진다.

import { hash8, normalizeTitle, type Fm5, type WikiPage } from "./vault.ts";
import type { LlmPage } from "./llm.ts";

export type VerifyIssue = {
  page: string;
  kind: "quote-없음" | "링크-해제" | "절-잠김" | "절-없음" | "이름-비었음";
  detail: string;
};

export type VerifiedRecord = {
  fact: string;
  /** 원문에서 찾은 위치. 헤딩이 있으면 그 이름, 없으면 null. */
  anchor: string | null;
};

export type VerifiedPage = {
  name: string;
  aliasesToAdd: string[];
  summary: string | null;
  newSections: { heading: string; content: string }[];
  /** 매칭과 잠금 확인을 통과한 것만. 실패한 것은 newSections 로 우회되어 있다. */
  appends: { heading: string; content: string }[];
  records: VerifiedRecord[];
};

export type VerifyResult = {
  pages: VerifiedPage[];
  issues: VerifyIssue[];
};

/** quote 대조용 정규화. 공백과 구두점을 지운다. 조사나 어미를 다듬은 정도는 통과시킨다. */
function normQuote(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\s.,!?"'`·…—\-()[\]{}]/g, "")
    .toLowerCase();
}

/**
 * 원문에서 quote 를 찾고 **찾은 위치의 헤딩**을 돌려준다.
 * ADR-0002 결정 4 — 한 번의 대조로 검증과 근거 추적을 함께 얻는다.
 */
function findQuote(sourceBody: string, quote: string): { found: boolean; anchor: string | null } {
  const needle = normQuote(quote);
  if (needle.length < 4) return { found: false, anchor: null };

  // 헤딩으로 구간을 나눈다. 헤딩이 없으면 구간이 하나뿐이고 anchor 는 null 이다.
  const lines = sourceBody.split(/\r?\n/);
  let current: string | null = null;
  const segments: { anchor: string | null; text: string }[] = [{ anchor: null, text: "" }];
  for (const line of lines) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      current = h[1].trim();
      segments.push({ anchor: current, text: "" });
    } else {
      segments[segments.length - 1].text += line + "\n";
    }
  }

  for (const seg of segments) {
    if (normQuote(seg.text).includes(needle)) return { found: true, anchor: seg.anchor };
  }
  return { found: false, anchor: null };
}

/**
 * 목록 밖 링크는 괄호만 벗긴다. 텍스트는 남긴다 — 정보를 잃지 않는다.
 * 자기 자신을 가리키는 링크도 벗긴다. 클릭해도 같은 페이지이므로 의미가 없고,
 * 링크 밀도를 부풀린다.
 */
function stripUnknownLinks(
  text: string,
  known: Set<string>,
  selfName: string,
  onStrip: (name: string, reason: "목록밖" | "자기링크") => void,
): string {
  const self = normalizeTitle(selfName);
  return text.replace(/\[\[([^\]|#]+)(\|[^\]]+)?\]\]/g, (whole, name: string, alias?: string) => {
    const n = normalizeTitle(name);
    if (n === self) {
      onStrip(name, "자기링크");
      return alias ? alias.slice(1) : name;
    }
    if (known.has(n)) return whole;
    onStrip(name, "목록밖");
    return alias ? alias.slice(1) : name;
  });
}

/**
 * 본문에 다른 페이지의 이름이 글자로 있는데 링크가 안 걸린 곳에 대괄호를 씌운다.
 *
 * AI 는 이것을 자주 놓친다. 실측으로 걸린 링크와 놓친 링크가 같은 수였다
 * (5개 대 5개). `target_heading` 퍼지 매칭과 같은 성격이다 — **AI 에게
 * 정확성을 요구하는 대신 코드가 흡수한다** (ADR-0002 결정 2).
 *
 * 절마다 첫 등장에만 건다. 같은 이름을 여러 번 감싸면 본문이 지저분해진다.
 */
function autoLink(text: string, names: string[], selfName: string): string {
  const self = normalizeTitle(selfName);
  // 긴 이름부터 — 짧은 이름이 긴 이름의 일부를 먼저 삼키는 것을 막는다.
  const targets = names
    .filter((n) => normalizeTitle(n) !== self && n.length >= 2)
    .sort((a, b) => b.length - a.length);

  // 이미 링크된 구간은 건드리지 않는다. 홀수 인덱스가 링크다.
  const parts = text.split(/(\[\[[^\]]+\]\])/);
  const done = new Set<string>();

  for (let i = 0; i < parts.length; i += 2) {
    for (const name of targets) {
      const key = normalizeTitle(name);
      if (done.has(key)) continue;
      const idx = parts[i].indexOf(name);
      if (idx < 0) continue;
      parts[i] = parts[i].slice(0, idx) + `[[${name}]]` + parts[i].slice(idx + name.length);
      done.add(key);
    }
  }
  return parts.join("");
}

/** content 안의 `##` 는 `###` 으로 강등한다. 절 구조가 깨지는 것을 막되 내용은 살린다. */
function demoteHeadings(text: string): string {
  return text.replace(
    /^(#{1,2})\s+/gm,
    (_m, hashes: string) => "#".repeat(hashes.length + 2) + " ",
  );
}

export type VerifyInput = {
  llmPages: LlmPage[];
  /** 지금 처리하는 노트의 본문. quote 대조의 기준. */
  sourceBody: string;
  /** 볼트에 실재하는 페이지 이름과 별칭 전부. */
  knownNames: Set<string>;
  /** 기존 위키. 절 매칭과 해시 확인에 쓴다. */
  existing: Map<string, WikiPage>;
};

export function verify(input: VerifyInput): VerifyResult {
  const issues: VerifyIssue[] = [];
  const pages: VerifiedPage[] = [];

  // 링크 허용 목록에 **이번 호출에서 만들어질 페이지**를 더한다.
  // "실재한다"의 기준 시점은 호출 전이 아니라 처리가 끝난 뒤다 — 같은 호출에서
  // 나온 페이지들끼리 서로를 가리키는 것이 정상이고, 프롬프트의 보기가 그렇게
  // 되어 있다. 호출 전 목록으로 판정하면 AI 가 옳게 건 링크를 코드가 벗겨낸다.
  const known = new Set(input.knownNames);
  // 자동 링크 대상 — 실재하는 페이지의 **표시 이름**이 필요하다.
  // `knownNames` 는 정규화된 소문자라 본문에 그대로 끼울 수 없다.
  const displayNames = [
    ...[...input.existing.values()].map((w) => w.name),
    ...input.llmPages.map((x) => x.name?.trim()).filter((x): x is string => !!x),
  ];
  for (const p of input.llmPages) {
    if (p.name?.trim()) known.add(normalizeTitle(p.name.trim()));
  }

  for (const p of input.llmPages) {
    if (!p.name?.trim()) {
      issues.push({ page: "(이름 없음)", kind: "이름-비었음", detail: "페이지를 버렸습니다" });
      continue;
    }

    const target = input.existing.get(normalizeTitle(p.name));
    const newSections: { heading: string; content: string }[] = [];
    const appends: { heading: string; content: string }[] = [];

    const strip = (name: string, reason: "목록밖" | "자기링크") =>
      issues.push({
        page: p.name,
        kind: "링크-해제",
        detail:
          reason === "자기링크" ? `[[${name}]] — 자기 자신입니다` : `[[${name}]] — 목록에 없습니다`,
      });

    for (const s of p.new_sections ?? []) {
      newSections.push({
        heading: s.heading.trim(),
        content: demoteHeadings(
          autoLink(stripUnknownLinks(s.content, known, p.name, strip), displayNames, p.name),
        ),
      });
    }

    // 매칭 → 해시 확인. 둘이 같은 자리에 있어야 한다.
    for (const a of p.append_to_existing ?? []) {
      const wanted = normalizeTitle(a.target_heading);
      const content = demoteHeadings(
        autoLink(stripUnknownLinks(a.content, known, p.name, strip), displayNames, p.name),
      );

      const matched = target?.sections.find(
        (s) =>
          s.heading !== "요약" &&
          (normalizeTitle(s.heading) === wanted || normalizeTitle(s.heading).includes(wanted)),
      );

      if (!matched) {
        issues.push({
          page: p.name,
          kind: "절-없음",
          detail: `"${a.target_heading}" → 새 절로 우회`,
        });
        newSections.push({ heading: a.target_heading.trim(), content });
      } else if (!matched.ours) {
        issues.push({
          page: p.name,
          kind: "절-잠김",
          detail: `"${matched.heading}" 은 사용자가 고쳤습니다 → 새 절로 우회`,
        });
        newSections.push({ heading: a.target_heading.trim(), content });
      } else {
        appends.push({ heading: matched.heading, content });
      }
    }

    const records: VerifiedRecord[] = [];
    for (const r of p.new_records ?? []) {
      const { found, anchor } = findQuote(input.sourceBody, r.quote);
      if (!found) {
        issues.push({
          page: p.name,
          kind: "quote-없음",
          detail: `"${r.quote.slice(0, 40)}" → 이 기록 줄만 버립니다`,
        });
        continue;
      }
      records.push({ fact: r.fact.trim(), anchor });
    }

    // 요약이 사용자 편집이면 덮지 않는다.
    let summary = p.summary?.trim() || null;
    const sumSec = target?.sections.find((s) => s.heading === "요약");
    if (sumSec && !sumSec.ours && summary) {
      issues.push({ page: p.name, kind: "절-잠김", detail: "요약은 사용자가 고쳤습니다 → 유지" });
      summary = null;
    }

    pages.push({
      name: p.name.trim(),
      aliasesToAdd: (p.aliases_to_add ?? []).map((s) => s.trim()).filter(Boolean),
      summary,
      newSections,
      appends,
      records,
    });
  }

  return { pages, issues };
}

// ── 빌더 ──────────────────────────────────────────────────────────────

const OS_FORBIDDEN = /[/\\:*?"<>|]/g;

export function safeFileName(name: string): string {
  return name.replace(OS_FORBIDDEN, "").trim().slice(0, 120);
}

export type BuildInput = {
  page: VerifiedPage;
  /** 없으면 새로 만든다. */
  existing: WikiPage | undefined;
  /** 기록 줄의 출처 링크. 노트 이름 또는 출처 페이지 이름. */
  sourceName: string;
  /** 기록 줄의 날짜. null 이면 (날짜 미상). */
  date: string | null;
  today: string;
};

/** JSON 을 마크다운으로 조립한다. `##` 와 `>` 를 코드가 찍으므로 문법이 깨질 수 없다. */
export function buildMarkdown(input: BuildInput): string {
  const { page, existing, sourceName, date, today } = input;

  const summary = page.summary ?? existing?.summary ?? "";

  // 절: 기존 것을 순서대로 두고, append 를 붙이고, 새 절을 뒤에 더한다.
  type Sec = { heading: string; content: string; ours: boolean };
  const sections: Sec[] = [];
  for (const s of existing?.sections ?? []) {
    if (s.heading === "요약") continue;
    const add = page.appends.filter((a) => a.heading === s.heading);
    sections.push({
      heading: s.heading,
      content: add.length ? [s.content, ...add.map((a) => a.content)].join("\n\n") : s.content,
      // 덧붙였으면 우리 글이 되고, 그대로면 이전 판정을 유지한다.
      ours: add.length ? true : s.ours,
    });
  }
  for (const s of page.newSections) {
    const dup = sections.find((x) => normalizeTitle(x.heading) === normalizeTitle(s.heading));
    if (dup) {
      dup.content = [dup.content, s.content].join("\n\n");
      dup.ours = true;
    } else {
      sections.push({ heading: s.heading, content: s.content, ours: true });
    }
  }

  // 기록: append-only. 중복은 date + fact + source 로 판정한다.
  const records = [...(existing?.records ?? [])];
  const seen = new Set(records.map((r) => normQuote(r)));
  for (const r of page.records) {
    const anchor = r.anchor ? `#${r.anchor}` : "";
    const when = date ?? "(날짜 미상)";
    const line = `- ${when} ${r.fact} ← [[${sourceName}${anchor}]]`;
    if (!seen.has(normQuote(line))) {
      records.push(line);
      seen.add(normQuote(line));
    }
  }

  // 프론트매터 — 코드만 쓴다.
  const aliases = unique([...(existing?.fm.aliases ?? []), ...page.aliasesToAdd]).filter(
    (a) => normalizeTitle(a) !== normalizeTitle(page.name),
  );
  // `parseList` 가 읽을 때 `[[ ]]` 를 벗기므로 여기서 다시 붙인다.
  // 벗긴 채로 저장하면 갱신을 한 번 거칠 때마다 링크가 죽는다.
  const sources = unique([...(existing?.fm.sources ?? []), sourceName]);

  const hashes: Record<string, string> = {};
  if (summary) {
    // 사용자가 고친 절에는 새 지문을 찍지 않는다. 찍으면 다음 정리에 덮인다.
    const sumSec = existing?.sections.find((s) => s.heading === "요약");
    const summaryOurs = page.summary !== null || !sumSec || sumSec.ours;
    if (summaryOurs) hashes["요약"] = hash8(summary);
  }
  for (const s of sections) {
    if (s.ours) hashes[s.heading] = hash8(s.content);
  }
  const recordsBody = records.join("\n");
  // 기록 절은 예외 — 사용자가 고쳤으면 지문을 갱신하지 않되 새 줄은 덧붙인다.
  if (existing?.records.length === 0 || existing?.recordsOurs !== false) {
    hashes["기록"] = hash8(recordsBody);
  }

  const fm: Fm5 = {
    aliases,
    sources,
    created: existing?.fm.created ?? today,
    compiledAt: new Date().toISOString(),
    hashes,
  };

  const out: string[] = ["---"];
  if (aliases.length) out.push(`aliases: [${aliases.join(", ")}]`);
  out.push(`sources: [${sources.map((s) => `"[[${s}]]"`).join(", ")}]`);
  out.push(`created: ${fm.created}`);
  out.push(`compiledAt: ${fm.compiledAt}`);
  if (Object.keys(hashes).length) {
    out.push("hashes:");
    for (const [k, v] of Object.entries(hashes)) out.push(`  ${k}: ${v}`);
  }
  out.push("---", "", `# ${page.name}`);
  if (summary) out.push("", `> ${summary}`);
  for (const s of sections) out.push("", `## ${s.heading}`, "", s.content);
  if (records.length) out.push("", "## 기록", "", recordsBody);
  out.push("");

  return out.join("\n");
}

/** 출력 벽 1 — AI 가 "네, 작성하겠습니다" 한 줄만 뱉은 경우 기존 위키를 지키기 위해. */
export function looksEmpty(markdown: string): boolean {
  const body = markdown.replace(/^---[\s\S]*?---/, "").trim();
  return body.length < 40 || !/^#\s/m.test(body);
}

function unique(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    const k = normalizeTitle(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}
