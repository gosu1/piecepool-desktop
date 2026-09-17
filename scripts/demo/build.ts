// 검문과 빌더 — ADR-0002 결정 2·4·5.
//
// 검문이 빌더보다 앞이다. JSON 상태에서 걸러야 배열 항목 제거로 끝난다.
// 매칭과 잠금 확인도 검문이 함께 한다 — 나뉘면 확인한 절과 쓰는 절이 달라진다.

import { hash8, normalizeTitle, type Fm5, type WikiPage } from "./vault.ts";
import type { LlmPage } from "./llm.ts";
import { buildVocab, restoreTypos } from "./spell.ts";

export type VerifyIssue = {
  page: string;
  kind:
    | "quote-없음"
    | "링크-해제"
    | "절-잠김"
    | "절-없음"
    | "절-보호"
    | "이름-비었음"
    | "나-기록-중복"
    | "기록-중복"
    | "오타-되돌림"
    | "별칭-차단";
  detail: string;
};

export type VerifiedRecord = {
  fact: string;
  /** 원문 구절. 저장하지 않고 중복 판정에만 쓴다. */
  quote: string;
  /** 원문에서 찾은 위치. 헤딩이 있으면 그 이름, 없으면 null. */
  anchor: string | null;
};

export type VerifiedPage = {
  name: string;
  aliasesToAdd: string[];
  summary: string | null;
  newSections: { heading: string; content: string }[];
  /** 절을 통째로 바꾼다. 매칭과 잠금 확인을 통과한 것만. 실패한 것은 newSections 로 우회되어 있다. */
  replaces: { heading: string; content: string }[];
  records: VerifiedRecord[];
};

export type VerifyResult = {
  pages: VerifiedPage[];
  issues: VerifyIssue[];
};

/**
 * quote 대조용 정규화. 공백과 구두점, 마크다운 강조 표시를 지운다. 조사나 어미를 다듬은 정도는
 * 통과시킨다. 강조 표시를 안 지우면 노트의 `23.5% → **14.0%**` 와 quote `23.5% → 14.0%` 가
 * 안 맞아 정답 사실이 버려진다 (연구자 볼트 28·30회차 실측).
 */
function normQuote(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\s.,!?"'`·…—\-()[\]{}*_~>#|]/g, "")
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
  // 헤딩의 강조 표시(`**총평**`)는 앵커에서 뺀다 — 옵시디언 링크 `#**총평**` 은 안 열린다 (41회차).
  const lines = sourceBody.split(/\r?\n/);
  let current: string | null = null;
  const segments: { anchor: string | null; text: string }[] = [{ anchor: null, text: "" }];
  for (const line of lines) {
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) {
      current = h[1].replace(/[*_`]/g, "").trim();
      segments.push({ anchor: current, text: "" });
    } else {
      segments[segments.length - 1].text += line + "\n";
    }
  }

  // 끝의 조사 하나("…실제 데이터" 를 "…실제 데이터는" 으로) 때문에 정확한 인용을 버리지
  // 않는다. 12자 이상일 때만 끝 1~2자를 잘라 다시 찾는다 — 짧은 인용은 그대로 엄격하다.
  const needles = [needle];
  if (needle.length >= 12) needles.push(needle.slice(0, -1), needle.slice(0, -2));
  for (const seg of segments) {
    const hay = normQuote(seg.text);
    if (needles.some((n) => hay.includes(n))) return { found: true, anchor: seg.anchor };
  }

  // 구간 하나에서 못 찾으면 문서 전체에서 찾는다 — 쪽 경계에 걸친 문장("probabil-" 과
  // 다음 쪽의 "ities")과 줄 끝 하이픈이 여기 걸린다 (40·41회차: 논문 10건, 실물 9건).
  // 벽은 그대로다: 원문에 글자 그대로 있어야 한다. 앵커는 인용이 시작하는 구간.
  const hays = segments.map((seg) => normQuote(seg.text));
  const whole = hays.join("");
  for (const n of needles) {
    const at = whole.indexOf(n);
    if (at < 0) continue;
    let offset = 0;
    for (let i = 0; i < segments.length; i++) {
      if (at < offset + hays[i].length) return { found: true, anchor: segments[i].anchor };
      offset += hays[i].length;
    }
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
  names: NameIndex,
  selfName: string,
  onStrip: (name: string, reason: "목록밖" | "자기링크" | "별칭충돌") => void,
): string {
  const self = normalizeTitle(selfName);
  return text.replace(/\[\[([^\]|#]+)(\|[^\]]+)?\]\]/g, (whole, name: string, alias?: string) => {
    const n = normalizeTitle(name);
    if (n === self) {
      onStrip(name, "자기링크");
      return alias ? alias.slice(1) : name;
    }
    // ADR-0002 결정 9 의 해석 순서. 파일명이 항상 별칭을 이긴다 — 파일 시스템이 유일성을
    // 보장하는 쪽이 파일명이다. 별칭이 두 페이지에 걸리면 한쪽을 고르지 않고 해제한다.
    if (names.files.has(n)) return whole;
    const owners = names.aliases.get(n) ?? [];
    if (owners.length === 1) return whole;
    onStrip(name, owners.length > 1 ? "별칭충돌" : "목록밖");
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
  // 이름 하나를 감쌀 때마다 다시 나눈다 — 한 번만 나누면 방금 만든 `[[부산 여행]]` 안에서
  // 짧은 이름 `여행` 을 또 찾아 `[[부산 [[여행]]]]` 이 된다 (10회차 실측, 깨진 링크 1).
  let out = text;
  for (const name of targets) {
    const parts = out.split(/(\[\[[^\]]+\]\])/);
    for (let i = 0; i < parts.length; i += 2) {
      const idx = parts[i].indexOf(name);
      if (idx < 0) continue;
      parts[i] = parts[i].slice(0, idx) + `[[${name}]]` + parts[i].slice(idx + name.length);
      break;
    }
    out = parts.join("");
  }
  return out;
}

/**
 * 한 절 안에서 같은 이름의 링크는 첫 등장만 남기고 나머지는 글자로 푼다.
 * K3 는 이름이 나올 때마다 `[[환각]]` 을 걸어 한 문단에 다섯 번씩 들어갔다 — 86장 볼트의
 * 본문 링크 755개 중 275개가 이런 반복이었다 (40회차). 정답 세트(두 페이지가 이어졌나)에는
 * 영향이 없고 읽기만 편해진다.
 */
function dedupeLinks(text: string): string {
  const seen = new Set<string>();
  return text.replace(
    /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]+)?\]\]/g,
    (whole, name: string, _anchor?: string, alias?: string) => {
      const key = normalizeTitle(name);
      if (!seen.has(key)) {
        seen.add(key);
        return whole;
      }
      return alias ? alias.slice(1) : name;
    },
  );
}

/** content 안의 `##` 는 `###` 으로 강등한다. 절 구조가 깨지는 것을 막되 내용은 살린다. */
function demoteHeadings(text: string): string {
  return text.replace(
    /^(#{1,2})\s+/gm,
    (_m, hashes: string) => "#".repeat(hashes.length + 2) + " ",
  );
}

/** 정규화한 파일명 집합과, 정규화한 별칭 → 그 별칭을 가진 페이지 이름들. */
export type NameIndex = {
  files: Set<string>;
  aliases: Map<string, string[]>;
};

export function nameIndex(pages: Iterable<WikiPage>): NameIndex {
  const files = new Set<string>();
  const aliases = new Map<string, string[]>();
  for (const p of pages) {
    files.add(normalizeTitle(p.name));
    for (const a of p.fm.aliases ?? []) {
      const k = normalizeTitle(a);
      aliases.set(k, [...(aliases.get(k) ?? []), p.name]);
    }
  }
  return { files, aliases };
}

export type VerifyInput = {
  llmPages: LlmPage[];
  /** 지금 처리하는 노트의 본문. quote 대조의 기준. */
  sourceBody: string;
  /** 볼트에 실재하는 페이지 이름과 별칭. 링크 해석과 별칭 차단의 기준. */
  names: NameIndex;
  /** 기존 위키. 절 매칭과 해시 확인에 쓴다. */
  existing: Map<string, WikiPage>;
  /**
   * 깨진 낱말을 되돌릴 때 쓰는 어휘의 출처 — 볼트의 노트 본문 전부. 위키 본문은 넣지 않는다:
   * 앞 호출이 깨뜨린 낱말이 어휘에 들어가면 그 낱말은 영영 "맞는 낱말" 이 된다.
   */
  vocabTexts?: string[];
  /** 맞춤법 사전 — 낱말이면 true. 없으면 본문·사실의 오타는 되돌리지 않는다 (인용은 원문이 검증). */
  isWord?: (run: string) => boolean;
};

export function verify(input: VerifyInput): VerifyResult {
  const issues: VerifyIssue[] = [];
  const pages: VerifiedPage[] = [];

  // 링크 허용 목록에 **이번 호출에서 만들어질 페이지**를 더한다.
  // "실재한다"의 기준 시점은 호출 전이 아니라 처리가 끝난 뒤다 — 같은 호출에서
  // 나온 페이지들끼리 서로를 가리키는 것이 정상이고, 프롬프트의 보기가 그렇게
  // 되어 있다. 호출 전 목록으로 판정하면 AI 가 옳게 건 링크를 코드가 벗겨낸다.
  const names: NameIndex = {
    files: new Set(input.names.files),
    aliases: new Map(input.names.aliases),
  };

  // 출력 벽 6 — 파일 이름에 못 쓰는 글자를 뗀다. 프롬프트가 금지해도 AI 는
  // "Numbers Lie First: …" 처럼 넣는다 (16회차). 이름만 떼고 링크를 안 고치면 파일은
  // 콜론 없는 이름인데 링크는 콜론 있는 이름을 가리켜 깨진다. 이름을 고치고 본문의
  // 링크도 같은 이름으로 바꾼다.
  const rename = new Map<string, string>();
  const llmPages = input.llmPages.map((p) => {
    const raw = p.name?.trim() ?? "";
    const safe = safeFileName(raw);
    if (raw && safe !== raw) rename.set(normalizeTitle(raw), safe);
    return { ...p, name: safe };
  });
  const fixLinks = (text: string) =>
    rename.size === 0
      ? text
      : text.replace(/\[\[([^\]|#]+)([|#][^\]]*)?\]\]/g, (whole, name: string, rest?: string) => {
          const to = rename.get(normalizeTitle(name));
          return to ? `[[${to}${rest ?? ""}]]` : whole;
        });

  // 자동 링크 대상 — 실재하는 페이지의 **표시 이름**이 필요하다.
  // `names` 는 정규화된 소문자라 본문에 그대로 끼울 수 없다.
  const displayNames = [
    ...[...input.existing.values()].map((w) => w.name),
    ...llmPages.map((x) => x.name).filter((x) => !!x),
  ];
  for (const p of llmPages) {
    if (p.name) names.files.add(normalizeTitle(p.name));
  }

  // 깨진 낱말의 사전 — 이번 자료, 볼트의 노트들, 페이지 이름. 모델이 옮긴 낱말은 여기 있던 것이다.
  const vocab = buildVocab([
    input.sourceBody,
    ...(input.vocabTexts ?? []),
    ...[...input.existing.values()].map((w) => w.name),
  ]);

  for (const p of llmPages) {
    if (!p.name?.trim()) {
      issues.push({ page: "(이름 없음)", kind: "이름-비었음", detail: "페이지를 버렸습니다" });
      continue;
    }

    const target = input.existing.get(normalizeTitle(p.name));
    const newSections: { heading: string; content: string }[] = [];
    const replaces: { heading: string; content: string }[] = [];

    const strip = (name: string, reason: "목록밖" | "자기링크" | "별칭충돌") =>
      issues.push({
        page: p.name,
        kind: "링크-해제",
        detail:
          reason === "자기링크"
            ? `[[${name}]] — 자기 자신입니다`
            : reason === "별칭충돌"
              ? `[[${name}]] — 별칭이 두 페이지에 걸립니다`
              : `[[${name}]] — 목록에 없습니다`,
      });

    // 깨진 낱말은 링크를 걸기 전에 되돌린다 — 링크 대상 이름도 낱말이다.
    // 인용은 원문이 검증하므로 사전 없이 되돌리고, 본문·사실은 사전이 "낱말 아님" 이라 할 때만.
    const fixTypos = (text: string, where: "본문" | "사실" | "인용") =>
      where === "인용" || input.isWord
        ? restoreTypos(
            text,
            vocab,
            (from, to) =>
              issues.push({
                page: p.name,
                kind: "오타-되돌림",
                detail: `${from}→${to} (${where})`,
              }),
            where === "인용" ? undefined : input.isWord,
          )
        : text;
    const clean = (text: string) =>
      demoteHeadings(
        dedupeLinks(
          autoLink(
            stripUnknownLinks(fixLinks(fixTypos(text, "본문")), names, p.name, strip),
            displayNames,
            p.name,
          ),
        ),
      );

    // 별칭 차단 — 다른 페이지의 제목이나 별칭이면 넣지 않는다 (결정 9 의 예방 2겹째).
    // 넣으면 그 이름의 링크가 두 페이지에 걸려 해제된다.
    const me = normalizeTitle(p.name);
    const aliasesToAdd: string[] = [];
    for (const raw of p.aliases_to_add ?? []) {
      const a = raw.trim();
      const k = normalizeTitle(a);
      if (!a || k === me) continue;
      const owners = (names.aliases.get(k) ?? []).filter((o) => normalizeTitle(o) !== me);
      if (names.files.has(k) || owners.length) {
        issues.push({
          page: p.name,
          kind: "별칭-차단",
          detail: `"${a}" 은 다른 페이지(${names.files.has(k) ? a : owners[0]})의 이름입니다`,
        });
        continue;
      }
      aliasesToAdd.push(a);
    }

    for (const s of p.new_sections ?? []) {
      const h = normalizeTitle(s.heading);
      if (h === "기록" || h === "요약") {
        issues.push({
          page: p.name,
          kind: "절-보호",
          detail: `"${s.heading}" 은 코드가 관리합니다 → 버립니다`,
        });
        continue;
      }
      newSections.push({ heading: s.heading.trim(), content: clean(s.content) });
    }

    // 매칭 → 해시 확인. 둘이 같은 자리에 있어야 한다.
    for (const e of p.replace_sections ?? []) {
      const wanted = normalizeTitle(e.target_heading);

      // `기록` 과 `요약` 은 코드가 관리한다. 본문 절이 없는 페이지에서 AI 가 `기록` 을
      // 다시 쓰려 했고, 우회 로직이 그것을 새 절 `기록` 으로 만들어 헤딩이 둘이 됐다
      // (3회차 실측). 우회하지 않고 버린다 — 기록은 new_records 로만 들어온다.
      if (wanted === "기록" || wanted === "요약") {
        issues.push({
          page: p.name,
          kind: "절-보호",
          detail: `"${e.target_heading}" 은 코드가 관리합니다 → 버립니다`,
        });
        continue;
      }

      const content = clean(e.content);

      const matched = target?.sections.find(
        (s) =>
          s.heading !== "요약" &&
          (normalizeTitle(s.heading) === wanted || normalizeTitle(s.heading).includes(wanted)),
      );

      if (!matched) {
        issues.push({
          page: p.name,
          kind: "절-없음",
          detail: `"${e.target_heading}" → 새 절로 우회`,
        });
        newSections.push({ heading: e.target_heading.trim(), content });
      } else if (!matched.ours) {
        // 같은 이름으로 우회하면 빌더가 잠긴 절에 합치고 지문을 새로 찍어, 다음 정리에서
        // 사용자의 글이 통째로 덮인다 (4회차 실측). 이름을 바꿔 **별개의 절**로 둔다.
        issues.push({
          page: p.name,
          kind: "절-잠김",
          detail: `"${matched.heading}" 은 사용자가 고쳤습니다 → "${matched.heading} (추가)" 로 우회`,
        });
        newSections.push({ heading: `${matched.heading} (추가)`, content });
      } else {
        replaces.push({ heading: matched.heading, content });
      }
    }

    // 이미 이 페이지에 있는 기록 — 같은 사실을 또 넣지 않는다. 관련 위키를 보낼 때 기록 절을
    // 빼므로(프롬프트 크기) AI 는 이미 기록된 사실을 모른다. 그 몫을 코드가 맡는다.
    const existingFacts = new Set(
      (target?.records ?? []).map((line) =>
        normQuote(
          line
            .replace(/^- (\d{4}-\d{2}-\d{2}|\(날짜 미상\))?\s*/, "")
            .replace(/\s*←.*$/, "")
            .replace(/\s*\(AI\)\s*$/, ""),
        ),
      ),
    );

    const records: VerifiedRecord[] = [];
    for (const r of p.new_records ?? []) {
      let quote = r.quote;
      let hit = findQuote(input.sourceBody, quote);
      if (!hit.found) {
        // 인용의 받침 오타 — 원문으로 되돌린 인용이 원문에 있으면 통과. 기록 줄에는 원문 글자.
        const restored = fixTypos(quote, "인용");
        if (restored !== quote) {
          hit = findQuote(input.sourceBody, restored);
          quote = restored;
        }
      }
      if (!hit.found) {
        issues.push({
          page: p.name,
          kind: "quote-없음",
          detail: `"${r.quote.slice(0, 40)}" → 이 기록 줄만 버립니다`,
        });
        continue;
      }
      const fact = fixTypos(r.fact.trim(), "사실");
      const key = normQuote(fact);
      if (existingFacts.has(key)) {
        issues.push({
          page: p.name,
          kind: "기록-중복",
          detail: `"${fact.slice(0, 40)}" 은 이미 있습니다`,
        });
        continue;
      }
      existingFacts.add(key);
      records.push({ fact, quote, anchor: hit.anchor });
    }

    // 요약이 사용자 편집이면 덮지 않는다.
    // 요약에도 링크를 건다 — "CNN 은 신경망 구조다" 같은 상위 개념 언급이 요약에만 있어서
    // 본문만 걸면 그 연결이 사라진다 (1회차: 들어오는 링크 없는 11장 중 여럿이 이 경우).
    // 요약은 한 줄이라 헤딩 강등은 필요 없다.
    let summary = p.summary?.trim() ? clean(p.summary.trim()).replace(/\r?\n+/g, " ") : null;
    const sumSec = target?.sections.find((s) => s.heading === "요약");
    if (sumSec && !sumSec.ours && summary) {
      issues.push({ page: p.name, kind: "절-잠김", detail: "요약은 사용자가 고쳤습니다 → 유지" });
      summary = null;
    }

    pages.push({
      name: p.name.trim(),
      aliasesToAdd: unique(aliasesToAdd),
      summary,
      newSections,
      replaces,
      records,
    });
  }

  // `나` 허브의 기록 — 같은 호출의 다른 페이지에 같은 구절의 기록이 있으면 중복이다.
  // 프롬프트로는 안 막혔고(2회차: 34건), 표본은 전부 주제 페이지에도 있었다. 다른 곳에
  // 없는 것만 남긴다 — 사실을 잃지 않으면서 허브가 일기가 되는 것을 막는다.
  const me = pages.find((x) => normalizeTitle(x.name) === "나");
  if (me) {
    const elsewhere = new Set(
      pages.filter((x) => x !== me).flatMap((x) => x.records.map((r) => normQuote(r.quote))),
    );
    const kept = me.records.filter((r) => !elsewhere.has(normQuote(r.quote)));
    if (kept.length !== me.records.length) {
      issues.push({
        page: "나",
        kind: "나-기록-중복",
        detail: `${me.records.length - kept.length}건은 주제 페이지에 있어 뺐습니다`,
      });
      me.records = kept;
    }
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
  /** 기록 줄의 출처 링크. 노트 이름 또는 출처 페이지 이름. null 이면 정리용 재작성 — 출처를 더하지 않는다. */
  sourceName: string | null;
  /** 기록 줄의 날짜. null 이면 (날짜 미상). */
  date: string | null;
  today: string;
};

/** JSON 을 마크다운으로 조립한다. `##` 와 `>` 를 코드가 찍으므로 문법이 깨질 수 없다. */
export function buildMarkdown(input: BuildInput): string {
  const { page, existing, sourceName, date, today } = input;

  const summary = page.summary ?? existing?.summary ?? "";

  // 절: 기존 것을 순서대로 두고, 다시 쓴 것은 바꾸고, 새 절을 뒤에 더한다.
  type Sec = { heading: string; content: string; ours: boolean };
  const sections: Sec[] = [];
  for (const s of existing?.sections ?? []) {
    if (s.heading === "요약") continue;
    const rep = page.replaces.find((r) => r.heading === s.heading);
    sections.push({
      heading: s.heading,
      content: rep ? rep.content : s.content,
      // 다시 썼으면 우리 글이 되고, 그대로면 이전 판정을 유지한다.
      ours: rep ? true : s.ours,
    });
  }
  for (const s of page.newSections) {
    const dup = sections.find((x) => normalizeTitle(x.heading) === normalizeTitle(s.heading));
    if (dup && dup.ours) {
      dup.content = [dup.content, s.content].join("\n\n");
    } else if (dup) {
      // 잠긴 절에는 합치지 않는다. 합치면 사용자의 글에 지문이 새로 찍혀 우리 글이 된다.
      sections.push({ heading: `${s.heading} (추가)`, content: s.content, ours: true });
    } else {
      sections.push({ heading: s.heading, content: s.content, ours: true });
    }
  }

  // `나` 허브는 절이 링크 집합이다. 다시 쓸 때 AI 가 링크를 빠뜨릴 수 있으므로
  // **기존 링크와 합집합**을 취한다 — 허브에서 링크는 늘기만 한다. 링크가 벗겨진
  // 이름이 글자로 남거나 같은 링크가 두 번 들어가는 것도 여기서 정리된다.
  if (normalizeTitle(page.name) === "나") {
    for (const s of sections) {
      if (!s.ours) continue;
      const before = existing?.sections.find((x) => x.heading === s.heading)?.content ?? "";
      s.content = linkSet(before + "\n" + s.content);
    }
    // 링크 집합이 다른 절과 똑같은 절은 버린다. AI 가 `공부` 를 `공유` 로 잘못 내면 같은 링크
    // 42개가 두 절에 들어가고, 합집합은 절 사이 중복을 못 잡는다 (7·11회차 실측). 뒤에 생긴
    // 쪽을 버린다. 부분집합(`여행` ⊂ `공부`)은 분류이므로 둔다. 잠긴 절은 건드리지 않는다.
    const linksOf = (c: string) => (c.match(/\[\[[^\]]+\]\]/g) ?? []).sort().join(" ");
    for (let i = sections.length - 1; i >= 0; i--) {
      const me = sections[i];
      if (!me.ours || !me.content) continue;
      const dup = sections.some((o, j) => j < i && linksOf(o.content) === linksOf(me.content));
      if (dup) sections.splice(i, 1);
    }
  }

  // 기록: append-only. 중복은 date + fact + source 로 판정한다.
  const records = [...(existing?.records ?? [])];
  const seen = new Set(records.map((r) => normQuote(r)));
  for (const r of page.records) {
    const anchor = r.anchor ? `#${r.anchor}` : "";
    const when = date ?? "(날짜 미상)";
    // AI 가 fact 앞에 노트 날짜를 또 붙이기도 한다 ("2026-10-08 2026-10-08 첫 운동으로…"). 뗀다.
    const fact = date ? r.fact.replace(new RegExp(`^${date}\\s*`), "") : r.fact;
    // AI 턴(`## N턴 (AI)`)에서 찾은 quote 는 `(AI)` 를 붙인다 — 상위 §8.2 의 꼬리표.
    // 사용자가 한 말과 AI 가 한 말이 한눈에 갈리고, 다음 정리의 AI 도 "사용자 자료가 아니다" 를 안다.
    const ai = r.anchor && /\(AI\)\s*$/.test(r.anchor) ? " (AI)" : "";
    const line = `- ${when} ${fact} ← [[${sourceName ?? "?"}${anchor}]]${ai}`;
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
  const sources = unique([...(existing?.fm.sources ?? []), ...(sourceName ? [sourceName] : [])]);

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
  // 날짜순. 처리 순서대로 쌓으면 2020년 논문의 줄이 2026년 일기 뒤에 붙는다 (PDF 실측).
  // 우리 글일 때만 — 사용자가 고친 기록 절은 순서도 사용자 것이다. 날짜 미상은 맨 뒤.
  if (existing?.recordsOurs !== false) {
    const key = (l: string) => /^- (\d{4}-\d{2}-\d{2})/.exec(l)?.[1] ?? "9999";
    records.sort((a, b) => key(a).localeCompare(key(b)));
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

/**
 * 검문을 통과한 뒤 페이지에 남은 것이 있는가.
 * 없으면 새 페이지는 만들지 않고(출력 벽 1), 기존 페이지는 쓰지 않는다 — 쓰면
 * 내용은 그대로인데 `sources` 에 노트가 하나 더 붙고 `compiledAt` 만 바뀐다.
 *
 * 예전 `looksEmpty` 는 "본문 40자 미만" 을 봤는데, 링크 하나만 덧붙는 `나` 허브
 * 갱신을 빈 깡통으로 오판했다 (2026-09-15 실측). Structured Outputs 로 JSON 이
 * 강제되고 `#` 을 코드가 찍는 지금은 글자 수를 볼 이유가 없다.
 */
/**
 * 소급 링크 — 페이지가 새로 생겼을 때, **이미 쓰인** 페이지 본문에 그 이름이 글자로 있는 자리를
 * 링크로 바꾼다. `exp-007` 이 만들어질 때 `환각` 은 아직 절이어서 링크할 대상이 없었고, 나중에
 * `환각` 이 페이지가 되어도 exp-007 은 다시 쓰이지 않는다 (연구자 볼트 실측). AI 없이 코드가
 * 흡수한다. 우리 글인 절만 건드리고, 요약도 포함한다. 바뀐 페이지만 돌려준다.
 */
export function retroLink(
  pages: Iterable<WikiPage>,
  newNames: string[],
): { page: WikiPage; content: Map<string, string>; summary: string | null }[] {
  const targets = newNames.filter((n) => n.trim().length >= 2);
  if (!targets.length) return [];
  const out: { page: WikiPage; content: Map<string, string>; summary: string | null }[] = [];
  for (const page of pages) {
    const mine = normalizeTitle(page.name);
    const names = targets.filter((n) => normalizeTitle(n) !== mine);
    if (!names.length) continue;
    const changed = new Map<string, string>();
    let summary: string | null = null;
    for (const s of page.sections) {
      if (!s.ours) continue;
      // 이 절에 이미 그 링크가 있으면 또 걸지 않는다.
      const fresh = names.filter((n) => !s.content.toLowerCase().includes(`[[${n.toLowerCase()}`));
      if (!fresh.length) continue;
      const next = autoLink(s.content, fresh, page.name);
      if (next === s.content) continue;
      if (s.heading === "요약") summary = next;
      else changed.set(s.heading, next);
    }
    if (changed.size || summary !== null) out.push({ page, content: changed, summary });
  }
  return out;
}

export function hasChanges(page: VerifiedPage): boolean {
  return (
    page.summary !== null ||
    page.aliasesToAdd.length > 0 ||
    page.newSections.length > 0 ||
    page.replaces.length > 0 ||
    page.records.length > 0
  );
}

/** 본문에서 `[[링크]]` 만 뽑아 중복 없이 ` · ` 로 잇는다. 링크가 아닌 글자는 버린다. */
function linkSet(text: string): string {
  const links = (text.match(/\[\[[^\]]+\]\]/g) ?? []).map((m) => m.slice(2, -2).split("|")[0]);
  return unique(links)
    .map((l) => `[[${l}]]`)
    .join(" · ");
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
