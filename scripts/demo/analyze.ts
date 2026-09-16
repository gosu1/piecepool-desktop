// 실험 분석 — 위키 폴더와 실행 로그를 읽어 지표를 뽑는다.
//
//   node scripts/demo/analyze.ts fixtures/vault-life [run.log] [--eval fixtures/vault-life/eval.json] [--items out.tsv]
//
// 정답 세트(eval.json)가 볼트에 있거나 --eval 로 주어지면 재현율을 낸다 — 꼭 있어야 할 페이지,
// 있으면 안 되는 페이지, 꼭 이어져야 할 링크 쌍, 꼭 남아야 할 사실. 규칙을 더하기 전에 이 숫자를 본다.
//
// 재는 것: 링크 밀도 · 고립 페이지 · 절 누적 · 기록 분포 · 지적 종류별 집계 · `나` 허브 구조.
// ADR-0002 "측정 지표" 절의 실측 도구다. 앱에는 들어가지 않는다.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeTitle, readWikiPage, scanWiki, type WikiPage } from "./vault.ts";

type EvalSet = {
  must_pages: string[];
  must_not_pages: string[];
  must_links: [string, string][];
  must_facts: [string, string][];
};

/** `A|B|C` 를 대안 목록으로. */
const alts = (s: string) => s.split("|").map((x) => normalizeTitle(x));

function bodyLinks(page: WikiPage): string[] {
  const text = page.sections.map((s) => s.content).join("\n");
  return (text.match(/\[\[[^\]]+\]\]/g) ?? []).map((m) =>
    normalizeTitle(m.slice(2, -2).split("|")[0].split("#")[0]),
  );
}

function paragraphs(s: string): number {
  return s.split(/\n\s*\n/).filter((x) => x.trim()).length;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const evalIdx = argv.indexOf("--eval");
  const evalPath = evalIdx >= 0 ? argv.splice(evalIdx, 2)[1] : join(argv[0] ?? "", "eval.json");
  // 항목별 hit/miss 를 TSV 로 — compare.ts 가 두 회차의 안정 핵·뒤집힘을 센다.
  const itemsIdx = argv.indexOf("--items");
  const itemsPath = itemsIdx >= 0 ? argv.splice(itemsIdx, 2)[1] : null;
  const [vault, logPath] = argv;
  if (!vault) throw new Error("볼트 경로가 필요합니다");

  const pages: WikiPage[] = [];
  for (const p of await scanWiki(vault)) pages.push(await readWikiPage(vault, p));
  const byName = new Map(pages.map((p) => [normalizeTitle(p.name), p]));

  // 링크 그래프
  const out = new Map<string, Set<string>>();
  const inb = new Map<string, Set<string>>();
  const broken: string[] = [];
  for (const p of pages) {
    const me = normalizeTitle(p.name);
    out.set(me, new Set());
    for (const target of bodyLinks(p)) {
      if (!byName.has(target)) {
        // 별칭일 수 있다
        const viaAlias = pages.find((q) =>
          (q.fm.aliases ?? []).some((a) => normalizeTitle(a) === target),
        );
        if (!viaAlias) {
          broken.push(`${p.name} → [[${target}]]`);
          continue;
        }
      }
      out.get(me)!.add(target);
      if (!inb.has(target)) inb.set(target, new Set());
      inb.get(target)!.add(me);
    }
  }

  const totalLinks = [...out.values()].reduce((a, s) => a + s.size, 0);
  const density = pages.length ? totalLinks / pages.length : 0;
  const isolated = pages.filter(
    (p) => out.get(normalizeTitle(p.name))!.size === 0 && !inb.has(normalizeTitle(p.name)),
  );
  const noInbound = pages.filter(
    (p) => !inb.has(normalizeTitle(p.name)) && normalizeTitle(p.name) !== "나",
  );
  // `나` 허브는 모든 페이지를 가리키므로, 허브를 빼고 세어야 개념 사이의 연결이 보인다.
  const inbNoMe = (k: string) => [...(inb.get(k) ?? [])].filter((s) => s !== "나").length;
  const noInboundNoMe = pages.filter(
    (p) => inbNoMe(normalizeTitle(p.name)) === 0 && normalizeTitle(p.name) !== "나",
  );
  const linksNoMe = [...out.entries()].reduce((a, [k, s]) => a + (k === "나" ? 0 : s.size), 0);
  const densityNoMe = pages.length > 1 ? linksNoMe / (pages.length - 1) : 0;

  // 절 누적 — 문단 4개 이상인 절은 append 가 쌓인 것이다
  const fatSections: string[] = [];
  let sectionCount = 0;
  for (const p of pages) {
    for (const s of p.sections) {
      if (s.heading === "요약") continue;
      sectionCount++;
      const n = paragraphs(s.content);
      if (n >= 4) fatSections.push(`${p.name} / ${s.heading} (${n}문단)`);
    }
  }

  // 기록
  const recordCounts = pages.map((p) => ({ name: p.name, n: p.records.length }));
  const totalRecords = recordCounts.reduce((a, r) => a + r.n, 0);
  const topRecords = [...recordCounts].sort((a, b) => b.n - a.n).slice(0, 5);

  // 이름 겹침 의심 — 한 이름이 다른 이름을 품고 있으면 같은 주제가 둘일 수 있다
  const names = pages.map((p) => normalizeTitle(p.name));
  const overlap: string[] = [];
  for (const a of names) {
    for (const b of names) {
      if (a !== b && a.length >= 2 && b.includes(a) && a !== "나") overlap.push(`${b} ⊃ ${a}`);
    }
  }

  // 사용자 편집으로 판정된 절 — 실험에서는 전부 우리 글이어야 하므로 0 이 정상이다
  const lockedSections: string[] = [];
  for (const p of pages) {
    for (const s of p.sections) if (!s.ours) lockedSections.push(`${p.name} / ${s.heading}`);
    if (p.records.length && !p.recordsOurs) lockedSections.push(`${p.name} / 기록`);
  }

  // 로그 집계
  let issueLines: string[] = [];
  let calls = "";
  if (logPath) {
    const log = await readFile(logPath, "utf8");
    issueLines = log.split(/\r?\n/).filter((l) => /^\s+! /.test(l));
    calls = log.match(/AI 호출 \d+회.*$/m)?.[0] ?? "";
  }
  const issueByKind = new Map<string, number>();
  for (const l of issueLines) {
    const k = /^\s+! (\S+)/.exec(l)?.[1] ?? "?";
    issueByKind.set(k, (issueByKind.get(k) ?? 0) + 1);
  }

  // `나` 허브
  const me = byName.get("나");

  const L: string[] = [];
  L.push(`## 요약`);
  L.push(``);
  L.push(`| 지표 | 값 |`);
  L.push(`| --- | --- |`);
  L.push(`| 페이지 | ${pages.length} |`);
  L.push(`| 본문 링크 (고유 대상) | ${totalLinks} |`);
  L.push(`| 밀도 (링크/페이지) | ${density.toFixed(2)} |`);
  L.push(`| 깨진 링크 | ${broken.length} |`);
  L.push(`| 고립 (들어오는·나가는 링크 없음) | ${isolated.length} |`);
  L.push(`| 들어오는 링크 없음 (나 제외) | ${noInbound.length} |`);
  L.push(`| **허브 빼고** 밀도 | ${densityNoMe.toFixed(2)} |`);
  L.push(`| **허브 빼고** 들어오는 링크 없음 | ${noInboundNoMe.length} |`);
  L.push(
    `| 절 수 (요약·기록 제외) | ${sectionCount} (페이지당 ${(sectionCount / (pages.length || 1)).toFixed(1)}) |`,
  );
  L.push(`| 문단 4개 이상인 절 | ${fatSections.length} |`);
  L.push(
    `| 기록 줄 | ${totalRecords} (페이지당 ${(totalRecords / (pages.length || 1)).toFixed(1)}) |`,
  );
  L.push(`| 사용자 편집으로 판정된 절 | ${lockedSections.length} |`);
  L.push(`| 이름 겹침 의심 | ${overlap.length} |`);
  if (calls) L.push(`| 호출 | ${calls} |`);
  L.push(``);

  if (issueByKind.size) {
    L.push(`## 지적 (로그)`);
    L.push(``);
    for (const [k, n] of [...issueByKind.entries()].sort((a, b) => b[1] - a[1])) {
      L.push(`- ${k}: ${n}`);
    }
    L.push(``);
  }

  if (broken.length) L.push(`## 깨진 링크`, ``, ...broken.map((b) => `- ${b}`), ``);
  if (isolated.length) L.push(`## 고립 페이지`, ``, ...isolated.map((p) => `- ${p.name}`), ``);
  if (noInbound.length)
    L.push(`## 들어오는 링크 없음`, ``, ...noInbound.map((p) => `- ${p.name}`), ``);
  if (noInboundNoMe.length)
    L.push(`## 허브 빼고 들어오는 링크 없음`, ``, ...noInboundNoMe.map((p) => `- ${p.name}`), ``);
  if (fatSections.length) L.push(`## 문단이 쌓인 절`, ``, ...fatSections.map((s) => `- ${s}`), ``);
  if (lockedSections.length)
    L.push(`## 사용자 편집으로 판정된 절`, ``, ...lockedSections.map((s) => `- ${s}`), ``);
  if (overlap.length) L.push(`## 이름 겹침 의심`, ``, ...overlap.map((s) => `- ${s}`), ``);

  L.push(`## 기록이 많은 페이지`, ``, ...topRecords.map((r) => `- ${r.name}: ${r.n}`), ``);

  if (me) {
    L.push(`## 나 허브`, ``);
    L.push(`- 요약: ${me.summary || "(없음)"}`);
    for (const s of me.sections) {
      if (s.heading === "요약") continue;
      const links = (s.content.match(/\[\[[^\]]+\]\]/g) ?? []).length;
      const paras = paragraphs(s.content);
      const nonLink = s.content.replace(/\[\[[^\]]+\]\]/g, "").replace(/[·\s,]/g, "");
      L.push(
        `- ${s.heading}: 링크 ${links}, 문단 ${paras}${nonLink ? `, 링크 아닌 글자 ${nonLink.length}자` : ""}`,
      );
    }
    L.push(``);
  }

  // 정답 세트 대조
  let evalSet: EvalSet | null = null;
  try {
    evalSet = JSON.parse(await readFile(evalPath, "utf8")) as EvalSet;
  } catch {
    evalSet = null;
  }
  if (evalSet) {
    // 이름이 같거나, `exp-004 SummaC 한국어` 처럼 정답 이름 뒤에 설명이 붙은 것도 그 페이지다.
    const matches = (p: WikiPage, spec: string) => {
      const names = [p.name, ...(p.fm.aliases ?? [])].map(normalizeTitle);
      return alts(spec).some((a) => names.some((n) => n === a || n.startsWith(a + " ")));
    };
    const findPage = (spec: string) => pages.find((p) => matches(p, spec));
    const body = (p: WikiPage) =>
      p.summary + "\n" + p.sections.map((x) => x.content).join("\n") + "\n" + p.records.join("\n");
    const linksBetween = (a: WikiPage, b: WikiPage) => {
      const outA = bodyLinks(a);
      const outB = bodyLinks(b);
      const namesA = [a.name, ...(a.fm.aliases ?? [])].map(normalizeTitle);
      const namesB = [b.name, ...(b.fm.aliases ?? [])].map(normalizeTitle);
      return outA.some((l) => namesB.includes(l)) || outB.some((l) => namesA.includes(l));
    };

    const pageHits = evalSet.must_pages.map((spec) => [spec, !!findPage(spec)] as const);
    const notHits = evalSet.must_not_pages.map((spec) => [spec, !findPage(spec)] as const);
    const linkHits = evalSet.must_links.map(([a, b]) => {
      const pa = findPage(a);
      const pb = findPage(b);
      return [`${a} ↔ ${b}`, !!(pa && pb && pa !== pb && linksBetween(pa, pb))] as const;
    });
    const factHits = evalSet.must_facts.map(([spec, needle]) => {
      // 사실은 대안 페이지 중 어디에든 있으면 된다
      const cands = pages.filter((p) => matches(p, spec));
      const ok = cands.some((p) => needle.split("|").some((n) => body(p).includes(n)));
      return [`${spec} ⊃ "${needle}"`, ok] as const;
    });
    const pct = (xs: readonly (readonly [string, boolean])[]) =>
      `${xs.filter((x) => x[1]).length}/${xs.length} (${Math.round((100 * xs.filter((x) => x[1]).length) / (xs.length || 1))}%)`;

    L.push(`## 정답 대조 (${evalPath})`, ``);
    L.push(`| 항목 | 재현율 |`);
    L.push(`| --- | --- |`);
    L.push(`| 꼭 있어야 할 페이지 | ${pct(pageHits)} |`);
    L.push(`| 있으면 안 되는 페이지 (통과) | ${pct(notHits)} |`);
    L.push(`| 꼭 이어져야 할 링크 | ${pct(linkHits)} |`);
    L.push(`| 꼭 남아야 할 사실 | ${pct(factHits)} |`);
    L.push(``);
    const miss = (xs: readonly (readonly [string, boolean])[]) =>
      xs.filter((x) => !x[1]).map((x) => `- ${x[0]}`);
    if (miss(pageHits).length) L.push(`### 없는 페이지`, ``, ...miss(pageHits), ``);
    if (miss(notHits).length) L.push(`### 있으면 안 되는데 있는 페이지`, ``, ...miss(notHits), ``);
    if (miss(linkHits).length) L.push(`### 안 이어진 링크`, ``, ...miss(linkHits), ``);
    if (miss(factHits).length) L.push(`### 빠진 사실`, ``, ...miss(factHits), ``);

    if (itemsPath) {
      const rows = [
        ...pageHits.map(([k, ok]) => `${ok ? "hit" : "miss"}\t페이지\t${k}`),
        ...notHits.map(([k, ok]) => `${ok ? "hit" : "miss"}\t금지\t${k}`),
        ...linkHits.map(([k, ok]) => `${ok ? "hit" : "miss"}\t링크\t${k}`),
        ...factHits.map(([k, ok]) => `${ok ? "hit" : "miss"}\t사실\t${k}`),
        ...pages.map((p) => `page\t-\t${p.name}`),
      ];
      await writeFile(itemsPath, rows.join("\n") + "\n", "utf8");
    }
  }

  L.push(`## 페이지 목록`, ``);
  L.push(`| 페이지 | 절 | 기록 | 나감 | 들어옴 | 들어옴(허브 빼고) | 출처 |`);
  L.push(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const p of [...pages].sort((a, b) => a.name.localeCompare(b.name, "ko"))) {
    const k = normalizeTitle(p.name);
    L.push(
      `| ${p.name} | ${p.sections.filter((s) => s.heading !== "요약").length} | ${p.records.length} | ${out.get(k)!.size} | ${inb.get(k)?.size ?? 0} | ${inbNoMe(k)} | ${p.fm.sources?.length ?? 0} |`,
    );
  }
  L.push(``);

  if (issueLines.length) {
    L.push(`## 지적 전체`, ``, ...issueLines.map((l) => `- ${l.trim().slice(2)}`), ``);
  }

  console.log(L.join("\n"));
}

main().catch((e: unknown) => {
  console.error("실패:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
