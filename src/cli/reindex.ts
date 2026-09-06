import { openVault } from "../core/vault/open.ts";
import { saveIndex, scanVault } from "../core/index/scan.ts";
import { main } from "./run.ts";

await main(async () => {
  const [vaultRoot] = process.argv.slice(2);
  if (!vaultRoot) throw new Error("usage: npm run reindex -- <볼트경로>");

  const v = await openVault(vaultRoot);
  const ix = await scanVault(v);
  await saveIndex(v, ix);
  console.log(`노트 ${ix.titles.size}개, 링크 ${ix.links.length}개`);
});
