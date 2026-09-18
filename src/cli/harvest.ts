import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PiecePoolError } from "../core/errors.ts";
import { openVault } from "../core/vault/open.ts";
import { harvestLog } from "../core/agent/tasks/harvest.ts";
import { log, main } from "./run.ts";

// 키는 .env 에서: node --env-file=.env src/cli/harvest.ts <볼트> <세션id>
await main(async () => {
  const [vaultRoot, id] = process.argv.slice(2);
  if (!vaultRoot || !id) throw new Error("usage: npm run harvest -- <볼트경로> <세션id>");

  const v = await openVault(vaultRoot);
  const path = `.piecepool/sessions/${id}.md`;
  let text: string;
  try {
    text = await readFile(join(v.root, path), "utf8");
  } catch {
    throw new PiecePoolError("vault_not_found", `세션 로그가 없다: ${path}`);
  }

  const r = await harvestLog(v, id, text, { onProgress: log });
  console.log(
    r.commitOid ? `${r.written.length}건 반영됨 (${r.commitOid.slice(0, 8)})` : "이미 반영됨",
  );
});
