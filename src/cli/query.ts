import { createInterface } from "node:readline/promises";
import { openVault } from "../core/vault/open.ts";
import { ask, openedPages, type QuerySession } from "../core/agent/tasks/query.ts";
import { harvest } from "../core/agent/tasks/harvest.ts";
import { localDate } from "../core/ingest/wiki.ts";
import { log, main } from "./run.ts";

function newSession(): QuerySession {
  // 콜론은 Windows 파일명에 쓸 수 없다 — 이 id 가 sessions/<id>.md 가 된다.
  const now = new Date();
  return {
    id: now.toISOString().replace(/[:.]/g, "-"),
    // id 는 UTC 라 날짜가 하루 어긋날 수 있다. 날짜는 로컬로 따로 정한다.
    date: localDate(now),
    log: "",
    turns: [],
    history: [],
  };
}

await main(async () => {
  const [vaultRoot, ...rest] = process.argv.slice(2);
  if (!vaultRoot) throw new Error("usage: npm run query -- <볼트경로> [질문]");

  const v = await openVault(vaultRoot);
  const session = newSession();
  const question = rest.join(" ");

  if (question) {
    console.log(await ask(v, session, question, { onProgress: log }));
    return;
  }

  // 대화 모드 — 대명사를 시험하려면 턴이 이어져야 한다.
  console.log(`볼트: ${vaultRoot} · 세션 ${session.id}`);
  console.log("질문을 입력하십시오. 빈 줄이나 Ctrl-C 로 끝냅니다.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const line = (await rl.question("> ")).trim();
      if (!line) break;
      console.log("\n" + (await ask(v, session, line, { onProgress: log })) + "\n");
    }
    // 수확은 사용자가 고를 때만 (상위 §8.1). 턴이 없으면 로그도 없다.
    if (session.turns.length) {
      const pages = openedPages(session.stats?.opened ?? []).length;
      console.log(
        `세션 로그: .piecepool/sessions/${session.id}.md · ${session.turns.length / 2}턴 · 본 페이지 ${pages}장`,
      );
      const yes = (await rl.question("위키에 반영? [y/N] ")).trim().toLowerCase() === "y";
      if (yes) {
        const r = await harvest(v, session, { onProgress: log });
        console.log(
          r.commitOid ? `${r.written.length}건 반영됨 (${r.commitOid.slice(0, 8)})` : "이미 반영됨",
        );
      }
    }
  } finally {
    rl.close();
  }
});
