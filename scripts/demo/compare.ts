// 회차 비교 — analyze.ts --items 가 낸 TSV 를 항목 단위로 맞춘다.
//
//   node scripts/demo/compare.ts a.tsv b.tsv            같은 설정 두 회차: 안정 핵 · 뒤집힘 · 못 맞힘
//   node scripts/demo/compare.ts --base a1.tsv a2.tsv --test b.tsv
//                                                      다른 설정 b 를 기준 두 회차와: 비열등 · 우월 판정
//
// 정답 항목이 수십 개라 퍼센트는 항목 하나에 10점씩 움직인다. 같은 설정 두 회차가 이미
// 3~6항목 뒤집히므로, 다른 설정의 차이는 "둘 다 맞힌 것(안정 핵)에서 빠졌나 · 둘 다 못 맞힌 것을
// 맞혔나" 로만 읽는다. 뒤집힌 항목을 맞힌 것은 동전이다.

import { readFile } from "node:fs/promises";

type Items = { hits: Map<string, boolean>; pages: Set<string> };

async function load(path: string): Promise<Items> {
  const hits = new Map<string, boolean>();
  const pages = new Set<string>();
  for (const line of (await readFile(path, "utf8")).split("\n")) {
    const [state, kind, key] = line.split("\t");
    if (!key) continue;
    if (state === "page") pages.add(key);
    else hits.set(`${kind}\t${key}`, state === "hit");
  }
  return { hits, pages };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 1;
}

function list(keys: string[]): string[] {
  return keys.length ? keys.map((k) => `- ${k.replace("\t", " · ")}`) : ["- (없음)"];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const L: string[] = [];

  if (argv[0] === "--base") {
    const t = argv.indexOf("--test");
    const bases = await Promise.all(argv.slice(1, t).map(load));
    const test = await load(argv[t + 1]);
    const keys = [...bases[0].hits.keys()];
    const core = keys.filter((k) => bases.every((b) => b.hits.get(k)));
    const never = keys.filter((k) => bases.every((b) => !b.hits.get(k)));
    const flip = keys.filter((k) => !core.includes(k) && !never.includes(k));
    const lostCore = core.filter((k) => !test.hits.get(k));
    const wonNever = never.filter((k) => test.hits.get(k));
    const forbidden = keys.filter((k) => k.startsWith("금지") && !test.hits.get(k));
    L.push(
      `기준 ${bases.length}회차: 안정 핵 ${core.length} · 뒤집힘 ${flip.length} · 못 맞힘 ${never.length} (전체 ${keys.length})`,
    );
    L.push(``);
    L.push(
      `### 시험 회차가 안정 핵에서 놓친 것 (${lostCore.length}/${core.length})`,
      ...list(lostCore),
      ``,
    );
    L.push(
      `### 시험 회차가 못 맞힘에서 새로 맞힌 것 (${wonNever.length}/${never.length})`,
      ...list(wonNever),
      ``,
    );
    L.push(`### 금지 페이지 위반`, ...list(forbidden), ``);
    const verdict =
      lostCore.length >= 3
        ? "열등 (안정 핵 3개 이상 빠짐)"
        : lostCore.length <= 1 && forbidden.length === 0
          ? wonNever.length >= 2
            ? "비열등 · 우월 (못 맞힘 2개 이상 새로 맞힘)"
            : "비열등"
          : "판정 보류 (안정 핵 2개 빠짐 또는 금지 위반)";
    L.push(`**판정: ${verdict}**`);
    for (const [i, b] of bases.entries())
      L.push(
        `페이지 이름 Jaccard (기준 ${i + 1} vs 시험): ${jaccard(b.pages, test.pages).toFixed(2)}`,
      );
  } else {
    const [a, b] = await Promise.all(argv.slice(0, 2).map(load));
    const keys = [...a.hits.keys()];
    const core = keys.filter((k) => a.hits.get(k) && b.hits.get(k));
    const flip = keys.filter((k) => a.hits.get(k) !== b.hits.get(k));
    const never = keys.filter((k) => !a.hits.get(k) && !b.hits.get(k));
    L.push(
      `전체 ${keys.length} · 안정 핵 ${core.length} · 뒤집힘 ${flip.length} · 못 맞힘 ${never.length}`,
    );
    L.push(``);
    L.push(
      `### 뒤집힘 (한쪽만 맞힘)`,
      ...list(flip.map((k) => `${k} [${a.hits.get(k) ? "A" : "B"}]`)),
      ``,
    );
    L.push(`### 못 맞힘 (둘 다)`, ...list(never), ``);
    L.push(
      `페이지 수 A ${a.pages.size} · B ${b.pages.size} · 이름 Jaccard ${jaccard(a.pages, b.pages).toFixed(2)}`,
    );
    const onlyA = [...a.pages].filter((p) => !b.pages.has(p));
    const onlyB = [...b.pages].filter((p) => !a.pages.has(p));
    L.push(`A 에만: ${onlyA.join(", ") || "(없음)"}`);
    L.push(`B 에만: ${onlyB.join(", ") || "(없음)"}`);
  }
  console.log(L.join("\n"));
}

main().catch((e: unknown) => {
  console.error("실패:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
