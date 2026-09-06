import { openVault } from "../core/vault/open.ts";
import { ask } from "../core/agent/tasks/query.ts";
import { log, main } from "./run.ts";

await main(async () => {
  const [vaultRoot, ...rest] = process.argv.slice(2);
  const question = rest.join(" ");
  if (!vaultRoot || !question) throw new Error("usage: npm run query -- <볼트경로> <질문>");

  const v = await openVault(vaultRoot);
  // 콜론은 Windows 파일명에 쓸 수 없다 — 이 id 가 sessions/<id>.md 가 된다.
  const session = { id: new Date().toISOString().replace(/[:.]/g, "-"), log: "" };
  console.log(await ask(v, session, question, { onProgress: log }));
});
