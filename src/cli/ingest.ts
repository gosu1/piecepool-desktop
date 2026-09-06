import { openVault } from "../core/vault/open.ts";
import { run } from "../core/agent/tasks/ingest.ts";
import { log, main } from "./run.ts";

await main(async () => {
  const [vaultRoot, file] = process.argv.slice(2);
  if (!vaultRoot || !file) throw new Error("usage: npm run ingest -- <볼트경로> <파일>");

  const v = await openVault(vaultRoot);
  const r = await run(v, { kind: "file", path: file }, { onProgress: log });
  console.log(`${r.written.length}건 반영됨 (${r.commitOid})`);
});
