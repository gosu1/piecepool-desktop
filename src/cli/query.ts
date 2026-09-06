import { openVault } from "../core/vault/open.ts";
import { ask } from "../core/agent/tasks/query.ts";
import { log, main } from "./run.ts";

await main(async () => {
  const [vaultRoot, ...rest] = process.argv.slice(2);
  const question = rest.join(" ");
  if (!vaultRoot || !question) throw new Error("usage: npm run query -- <볼트경로> <질문>");

  const v = await openVault(vaultRoot);
  const session = { id: new Date().toISOString(), log: "" };
  console.log(await ask(v, session, question, { onProgress: log }));
});
