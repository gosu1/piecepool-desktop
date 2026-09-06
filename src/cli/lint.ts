import { openVault } from "../core/vault/open.ts";
import { run } from "../core/agent/tasks/lint.ts";
import { log, main } from "./run.ts";

await main(async () => {
  const [vaultRoot] = process.argv.slice(2);
  if (!vaultRoot) throw new Error("usage: npm run wiki:lint -- <볼트경로>");

  const v = await openVault(vaultRoot);
  for (const f of await run(v, { onProgress: log })) {
    console.log(`${f.kind}\t${f.path}\t${f.detail}`);
  }
});
