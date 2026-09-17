import { openVault } from "../core/vault/open.ts";
import { run } from "../core/agent/tasks/ingest.ts";
import { syncVault } from "../core/ingest/sync.ts";
import { wikiStats } from "../core/ingest/engine.ts";
import { log, main } from "./run.ts";

// 키는 .env 에서: node --env-file=.env src/cli/ingest.ts <볼트> [파일]
await main(async () => {
  const [vaultRoot, file] = process.argv.slice(2);
  if (!vaultRoot)
    throw new Error("usage: npm run ingest -- <볼트경로> [파일]  (파일 없으면 볼트 전체)");

  const v = await openVault(vaultRoot);
  if (file) {
    const r = await run(v, { kind: "file", path: file }, { onProgress: log });
    console.log(
      r.commitOid
        ? `${r.written.length}건 반영됨 (${r.commitOid.slice(0, 8)})`
        : "반영할 것이 없다",
    );
  } else {
    const r = await syncVault(v, { onProgress: log });
    console.log(
      `커밋 ${r.commits.length}개 · 지적 ${r.issues.length}건${r.halted ? " · 형식 불량이 잦아 멈춤" : ""}`,
    );
  }
  const s = await wikiStats(v);
  console.log(
    `위키 ${s.pages}장 · 링크 ${s.links}개 · 문서당 ${s.pages ? (s.links / s.pages).toFixed(2) : "0"}`,
  );
});
