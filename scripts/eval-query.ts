// 정답 세트 채점 — 세션이 "열어야 할 페이지" 를 열었는가.
//
//   node --env-file=.env scripts/eval-query.ts fixtures/vault-life
//
// 답변 문장의 옳고 그름은 채점하지 않는다 (설계 §10.3 · §10.6).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openVault } from "../src/core/vault/open.ts";
import { ask, type QuerySession } from "../src/core/agent/tasks/query.ts";
import { normalizeTitle } from "../src/core/index/links.ts";

type Eval = { questions: { q: string; must_open: string[] }[] };

const root = process.argv[2];
if (!root) throw new Error("usage: node scripts/eval-query.ts <볼트경로>");

const v = await openVault(root);
const spec = JSON.parse(await readFile(join(root, "eval-query.json"), "utf8")) as Eval;

/** 연 경로에서 페이지 이름만 뽑는다. `wiki/무릎 통증.md#증상` → `무릎 통증` */
function pageOf(opened: string): string {
  const file = opened.split("#")[0];
  return normalizeTitle((file.split("/").pop() ?? file).replace(/\.md$/i, ""));
}

let hit = 0;
const rows: string[] = [];

for (const { q, must_open } of spec.questions) {
  const session: QuerySession = {
    id: `eval-${Date.now()}`,
    log: "",
    turns: [],
    history: [],
  };
  await ask(v, session, q);
  const opened = new Set(
    (/^opened:\n((?:\s+- .*\n)*)/m.exec(session.log)?.[1] ?? "")
      .split("\n")
      .map((l) => l.replace(/^\s+-\s*/, "").trim())
      .filter(Boolean)
      .map(pageOf),
  );
  const ok = must_open.every((alt) =>
    alt.split("|").some((name) => opened.has(normalizeTitle(name))),
  );
  if (ok) hit++;
  rows.push(`${ok ? "O" : "X"}  ${q}\n     연 것: ${[...opened].join(", ") || "(없음)"}`);
}

console.log(rows.join("\n"));
console.log(
  `\n재현율 ${hit}/${spec.questions.length} (${((hit / spec.questions.length) * 100).toFixed(0)}%)`,
);
