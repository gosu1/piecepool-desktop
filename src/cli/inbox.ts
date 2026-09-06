import { openVault } from "../core/vault/open.ts";
import { run } from "../core/agent/tasks/inbox.ts";
import { log, main } from "./run.ts";

await main(async () => {
  const [vaultRoot] = process.argv.slice(2);
  if (!vaultRoot) throw new Error("usage: npm run inbox -- <볼트경로>");

  const v = await openVault(vaultRoot);
  const r = await run(v, { onProgress: log });
  console.log(`${r.written.length}건 반영됨 (${r.commitOid})`);
});
