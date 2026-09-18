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
let failed = 0;

for (const { q, must_open } of spec.questions) {
  const session: QuerySession = {
    id: `eval-${Date.now()}`,
    log: "",
    turns: [],
    history: [],
  };
  // 실비가 드는 하네스다 — 한 질문이 죽어도 이미 낸 결과는 남아야 하므로 끝날 때마다 바로 찍는다.
  try {
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
    console.log(`${ok ? "O" : "X"}  ${q}\n     연 것: ${[...opened].join(", ") || "(없음)"}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`E  ${q}\n     실패: ${msg}`);
  }
}

// 실패는 "못 찾음" 과 다르다 — LLM/네트워크 오류일 뿐 검색 실패가 아니므로 분모에서 뺀다.
const measured = spec.questions.length - failed;
console.log(
  `\n재현율 ${hit}/${measured} (${measured > 0 ? ((hit / measured) * 100).toFixed(0) : "?"}%)` +
    ` · 실패 ${failed}/${spec.questions.length}`,
);
