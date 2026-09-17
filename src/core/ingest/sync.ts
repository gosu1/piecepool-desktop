// 볼트 전체 정리 — 아직 안 한 노트·원본·세션 로그를 날짜순으로, 항목마다 커밋 하나.
import type { NotePath, Vault } from "../../shared/types.ts";
import type { IngestResult, IngestSource } from "../agent/tasks/ingest.ts";
import { Written } from "../agent/written.ts";
import {
  collectItems,
  type EngineOptions,
  itemFromSource,
  makeContext,
  markDeletedSources,
  processItem,
  readSyncState,
} from "./engine.ts";
import { rawHashOf, readRawHash, scanSources } from "./source.ts";
import { commitWritten, prepareRepo } from "./step.ts";
import { readItem, scanNotes } from "./wiki.ts";

/**
 * 자료 하나를 정리해 커밋 하나로. agent/tasks/ingest.run 의 본체다 — 그 진입점은 동결이라
 * 테스트용 가짜 AI(`llm`)를 받을 자리가 없어 여기로 뺐다.
 */
export async function ingestSource(
  v: Vault,
  src: IngestSource,
  o: EngineOptions & { extraPaths?: NotePath[] } = {},
): Promise<IngestResult> {
  const ctx = await makeContext(v, o);
  const written = new Written();
  const extra = o.extraPaths ?? [];
  // 봉인이 먼저다 — 볼트 밖 파일을 sources/ 로 복사하는 것도 우리 쓰기라 봉인 뒤에 한다.
  const created = await prepareRepo(v, extra, ctx.onProgress);
  const item = await itemFromSource(v, src, ctx.today, written, ctx.force);
  await processItem(v, item, ctx, written);
  return await commitWritten(
    v,
    `ingest(vault): ${item.name || item.key}`,
    written,
    [...created, ...extra],
    ctx.onProgress,
  );
}

export interface SyncResult {
  /** 커밋마다 자료 이름을 붙인다 — 화면이 "무엇을 되돌릴지" 보여 주는 데 쓴다. */
  commits: (IngestResult & { label: string })[];
  /** 검문 지적과 건너뜀 사유. `항목 종류 [페이지] 내용` 한 줄씩. */
  issues: string[];
  /** 형식 불량이 잦아 중간에 멈췄다. 처리 못 한 항목은 상태에 없어 다음 실행이 이어받는다. */
  halted: boolean;
}

export async function syncVault(v: Vault, o: EngineOptions = {}): Promise<SyncResult> {
  const ctx = await makeContext(v, o);
  const commits: SyncResult["commits"] = [];
  const issues: string[] = [];
  // 준비 중 생긴 경로(.gitignore)는 다음 커밋에 실어 보낸다. 따로 커밋하지 않는다.
  let carry: NotePath[] = [];
  const commitIf = async (label: string, written: Written) => {
    const r = await commitWritten(v, `ingest(vault): ${label}`, written, carry, ctx.onProgress);
    if (r.commitOid) {
      commits.push({ ...r, label });
      carry = [];
    }
  };

  // 출처가 사라졌으면 기록에 표시한다. 돌아왔으면 뗀다. 이것도 커밋 하나다.
  {
    const written = new Written();
    carry.push(...(await prepareRepo(v, [], ctx.onProgress)));
    await markDeletedSources(v, ctx.state, ctx.today, written, ctx.onProgress);
    await commitIf("사라진 출처 표시", written);
  }

  const items = await collectItems(v, ctx.today, ctx.force);
  for (const [i, item] of items.entries()) {
    if (ctx.schemaFails > 2) return { commits, issues, halted: true };
    ctx.onProgress?.({ step: "진행", detail: `${i + 1}/${items.length} ${item.name || item.key}` });
    const written = new Written();
    carry.push(...(await prepareRepo(v, carry, ctx.onProgress)));
    const outcome = await processItem(v, item, ctx, written);
    if (outcome.status === "done") issues.push(...outcome.issues.map((i) => `${item.key} ${i}`));
    else issues.push(`${item.key} ${outcome.reason}`);
    await commitIf(item.name || item.key, written);
  }
  return { commits, issues, halted: false };
}

/**
 * 아직 정리하지 않은 항목 수. 화면의 "노트 N장이 아직 위키에 없다" 가 이것이다.
 * PDF 추출은 하지 않는다 — 지문만 비교하므로 큰 볼트에서도 싸다.
 */
export async function countPending(v: Vault): Promise<number> {
  const state = await readSyncState(v);
  let n = 0;
  for (const p of await scanNotes(v)) {
    if (state.notes[p]?.hash !== (await readItem(v, p)).hash) n++;
  }
  for (const src of await scanSources(v)) {
    if ((await readRawHash(v, src)) !== (await rawHashOf(v, src))) n++;
  }
  return n;
}
