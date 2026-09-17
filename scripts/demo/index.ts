// 데모 — 파이프라인을 끝까지 관통한다. ADR-0002 가 실제로 작동하는지 보기 위한 것이다.
//
//   node --env-file=.env scripts/demo/index.ts --dry
//   node --env-file=.env scripts/demo/index.ts --only "DETR"
//   node --env-file=.env scripts/demo/index.ts --embed
//   node --env-file=.env scripts/demo/index.ts --bm25 --top 8
//
// ingest 엔진의 CLI 판이다. 앱에는 아직 안 꽂혀 있다 — 4단계에서 src/core/ 로 옮겨 꽂는다.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Vault } from "../../src/shared/types.ts";
import { normalizeTitle } from "../../src/core/index/links.ts";
import {
  hash8,
  loadWiki,
  localDate,
  readItem,
  readWikiPage,
  scanWiki,
  type WikiPage,
} from "../../src/core/ingest/wiki.ts";
import { buildUserMessage, pageEmbedText, pickCandidates } from "../../src/core/ingest/prompt.ts";
import {
  BudgetExceeded,
  MODELS,
  SETTINGS,
  askJson,
  balance,
  embed,
  embedStats,
  usage,
  usageSummary,
  writeWiki,
} from "./llm.ts";
import {
  buildMarkdown,
  hasChanges,
  nameIndex,
  retroLink,
  safeFileName,
  verify,
} from "../../src/core/ingest/build.ts";
import {
  buildSourcePage,
  extract,
  inputWall,
  rawHashOf,
  readRawHash,
  scanSources,
  sourceDate,
} from "../../src/core/ingest/source.ts";
import { commitFiles, type FileWrite } from "../../src/core/ingest/tx.ts";
import { loadDictionary } from "../../src/core/ingest/spell.ts";
import { scanNotes } from "../../src/core/ingest/wiki.ts";

type Args = {
  vault: string;
  dry: boolean;
  useEmbed: boolean;
  /** 모델 없는 후보 추리기(BM25). --embed 와 같이 켤 수도 있다. */
  useBm25: boolean;
  only: string | null;
  noCache: boolean;
  threshold: number;
  topN: number;
  /** 시스템 프롬프트 파일. 실험에서 옛 판과 비교할 때 바꾼다. */
  prompt: string;
  /** 이 글자 수까지는 통째로 한 번에 넘긴다. 넘으면 헤딩 경계로 나눠 청크마다 부른다. */
  maxChars: number;
  /** 정리 없이 소급 링크만 — 기존 위키 전체에 대해 한 번. */
  relink: boolean;
  /** `나` 요약을 이 장수마다 별도 호출로 다시 쓴다. 0 이면 안 한다. */
  meEvery: number;
  /** 이 달러를 넘으면 다음 호출 전에 멈춘다. 실비 모델용. 0 이면 상한 없음. */
  budget: number;
  /** 처리할 항목 수가 이것과 다르면 호출 전에 멈춘다. 볼트에 엉뚱한 파일이 섞인 사고 방지. */
  expect: number;
  /** 앞의 N장만 처리한다. 이어서 돌리면 sync_state 가 다음 장부터 재개한다. */
  limit: number;
  /** 이미 처리한 항목도 다시 정리한다 (결정 10 의 재정리 경로 시험용). --no-cache 와 별개다. */
  force: boolean;
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    vault: "fixtures/vault",
    dry: false,
    useEmbed: false,
    useBm25: false,
    only: null,
    noCache: false,
    // 0.65 · 5 — 캐시된 임베딩으로 오프라인 계산(2026-09-15): 0.65 에서 재현율 86% · 정밀도 34%,
    // 0.70 에서 62% · 67%. "러닝머신·헬스장 → 달리기" 가 0.67~0.76 에 있어 0.70 이면 하나를 놓친다.
    threshold: 0.65,
    topN: 5,
    prompt: "src/core/prompts/write.md",
    maxChars: 200_000,
    relink: false,
    meEvery: 20,
    budget: 0,
    expect: 0,
    limit: 0,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--vault") a.vault = argv[++i];
    else if (k === "--dry") a.dry = true;
    else if (k === "--embed") a.useEmbed = true;
    else if (k === "--bm25") a.useBm25 = true;
    else if (k === "--only") a.only = argv[++i];
    else if (k === "--no-cache") a.noCache = true;
    else if (k === "--threshold") a.threshold = Number(argv[++i]);
    else if (k === "--top") a.topN = Number(argv[++i]);
    else if (k === "--prompt") a.prompt = argv[++i];
    else if (k === "--max-chars") a.maxChars = Number(argv[++i]);
    else if (k === "--relink") a.relink = true;
    else if (k === "--me-every") a.meEvery = Number(argv[++i]);
    else if (k === "--budget") a.budget = Number(argv[++i]);
    else if (k === "--expect") a.expect = Number(argv[++i]);
    else if (k === "--limit") a.limit = Number(argv[++i]);
    else if (k === "--force") a.force = true;
  }
  return a;
}

/** 실험 볼트를 Vault 로. 쓰기 루트는 제품 기본값과 같다. */
function vaultOf(root: string): Vault {
  return { root: resolve(root), agentWriteRoots: ["wiki", "sources", ".piecepool"] };
}

/** 처리한 항목의 지문. `missing` 은 원본이 사라져 기록에 `(출처 삭제됨)` 을 붙인 상태. */
type SyncEntry = { hash: string; compiledAt: string; missing?: true };
type SyncState = {
  notes: Record<string, SyncEntry>;
  /** `나` 요약의 지문과, 그 지문이 유지된 동안 처리한 항목 수. 요약이 낡았는지 AI 에게 알리는 데 쓴다. */
  me?: { summaryHash: string; age: number };
};

async function readSyncState(vault: string): Promise<SyncState> {
  try {
    const raw = await readFile(join(vault, ".piecepool/sync_state.json"), "utf8");
    return JSON.parse(raw) as SyncState;
  } catch {
    return { notes: {} };
  }
}

async function writeSyncState(vault: string, st: SyncState): Promise<void> {
  const dir = join(vault, ".piecepool");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sync_state.json"), JSON.stringify(st, null, 2) + "\n", "utf8");
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * `나.md` 가 없으면 만든다. '나' 에 관한 페이지들의 목차이고, 레퍼런스의
 * overview.md / Home.md 와 같은 고정 허브다. 내용은 AI 가 채우고, 여기서는
 * 존재만 보장한다. 요약은 AI 가 큰 그림이 바뀔 때만 고친다.
 */
async function ensureMePage(vault: string, today: string): Promise<void> {
  if (await exists(join(vault, "wiki", "나.md"))) return;
  // 초기 요약에도 지문을 찍는다. 없으면 "지문 없음 = 사용자 편집" 규칙에 걸려
  // 코드가 만든 자리 표시 문장을 AI 가 영영 못 고친다 (2026-09-14 실측).
  const summary = "아직 정리된 것이 없다.";
  const md = [
    "---",
    `created: ${today}`,
    `compiledAt: ${new Date().toISOString()}`,
    "hashes:",
    `  요약: ${hash8(summary)}`,
    "---",
    "",
    "# 나",
    "",
    `> ${summary}`,
    "",
  ].join("\n");
  await commitFiles(vaultOf(vault), [{ path: "wiki/나.md", content: md }]);
  console.log("   wiki/나.md 를 만들었습니다 (허브)");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 기록 줄이 이 출처를 가리키는가. `← [[이름]]` 또는 `← [[이름#절]]`. */
function sourceTag(name: string): RegExp {
  return new RegExp(`← \\[\\[${escapeRe(name)}(\\]\\]|#)`);
}

/**
 * **본문** 링크 개수. 사업계획서의 기준선 1.5 와 비교한다.
 * 프론트매터의 sources 와 기록 줄의 `← [[출처]]` 는 세지 않는다 — 그것은
 * 출처 표기이고, 여기서 재려는 것은 개념 사이의 연결이다.
 */
function countBodyLinks(markdown: string): number {
  const body = markdown.replace(/^---[\s\S]*?\r?\n---\r?\n/, "").replace(/^## 기록[\s\S]*$/m, "");
  // 고유 대상만 센다. 같은 페이지를 두 번 가리키는 것을 두 번 세면 밀도가 부풀려진다.
  const names = (body.match(/\[\[[^\]]+\]\]/g) ?? []).map((m) =>
    m.slice(2, -2).split("|")[0].split("#")[0].trim().toLowerCase(),
  );
  return new Set(names).size;
}

function wikiPath(name: string): string {
  return `wiki/${safeFileName(name)}.md`;
}

/** 정리용 재작성 — 기록만 바뀐 페이지를 같은 빌더로 다시 조립한다. 출처는 더하지 않는다. */
function rebuildRecordsOnly(existing: WikiPage, today: string): string {
  return buildMarkdown({
    page: {
      name: existing.name,
      aliasesToAdd: [],
      summary: null,
      newSections: [],
      replaces: [],
      records: [],
    },
    existing,
    sourceName: null,
    date: null,
    today,
  });
}

const DELETED_MARK = " (출처 삭제됨)";

/**
 * 출처가 사라졌거나 돌아왔을 때 기록 줄의 표시를 붙이거나 뗀다. 지우지 않는다 —
 * 의도를 모르면 파괴하지 않는다. 사용자가 기록 절을 고친 페이지는 건드리지 않는다.
 */
async function markDeletedSources(vault: string, state: SyncState, today: string): Promise<void> {
  const changes: { key: string; name: string; missing: boolean }[] = [];
  for (const [key, entry] of Object.entries(state.notes)) {
    const present = await exists(join(vault, key));
    const name = key.startsWith("sources/")
      ? "@" + key.slice("sources/".length).replace(/\.[^.]+$/, "")
      : key.startsWith(".piecepool/sessions/")
        ? "@session-" + key.slice(".piecepool/sessions/".length).replace(/\.[^.]+$/, "")
        : key.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
    if (!present && !entry.missing) changes.push({ key, name, missing: true });
    if (present && entry.missing) changes.push({ key, name, missing: false });
  }
  if (!changes.length) return;

  const wiki = await loadWiki(vaultOf(vault));
  const writes: FileWrite[] = [];
  for (const page of wiki.values()) {
    if (!page.recordsOurs) continue;
    let touched = false;
    page.records = page.records.map((line) => {
      for (const c of changes) {
        if (!sourceTag(c.name).test(line)) continue;
        if (c.missing && !line.endsWith(DELETED_MARK)) {
          touched = true;
          return line + DELETED_MARK;
        }
        if (!c.missing && line.endsWith(DELETED_MARK)) {
          touched = true;
          return line.slice(0, -DELETED_MARK.length);
        }
      }
      return line;
    });
    if (touched)
      writes.push({
        path: wikiPath(page.name),
        content: rebuildRecordsOnly(page, today),
        mustExist: true,
      });
  }
  await commitFiles(vaultOf(vault), writes);
  for (const c of changes) {
    if (c.missing) state.notes[c.key].missing = true;
    else delete state.notes[c.key].missing;
    console.log(
      `   출처 ${c.missing ? "삭제됨" : "복구됨"}: ${c.key} → 기록 ${writes.length}장에 표시`,
    );
  }
  await writeSyncState(vault, state);
}

/**
 * `나` 요약을 다시 쓴다 — 노트 한 장의 호출로는 "지금의 나" 를 쓸 재료가 없다 (87장 뒤에도
 * 첫 노트의 요약이 그대로였고, 힌트를 줘도 null 을 냈다). 그래서 N장마다 한 번, `나` 가 가리키는
 * 페이지들의 요약을 모아 작은 별도 호출로 쓴다. 소스당 1회 원칙에 1/N 을 얹는다.
 */
async function refreshMeSummary(vault: string, today: string): Promise<boolean> {
  const wiki = await loadWiki(vaultOf(vault));
  const me = wiki.get("나");
  if (!me) return false;
  const sumSec = me.sections.find((s) => s.heading === "요약");
  if (sumSec && !sumSec.ours) return false; // 사용자가 고친 요약은 건드리지 않는다
  const linked = new Set(
    me.sections
      .flatMap((s) => s.content.match(/\[\[[^\]|#]+/g) ?? [])
      .map((l) => normalizeTitle(l.slice(2))),
  );
  const lines = [...wiki.values()]
    .filter((p) => linked.has(normalizeTitle(p.name)) && p.summary)
    .map((p) => `- ${p.name}: ${p.summary}`);
  const user = [
    `<옛 요약>\n${me.summary}\n</옛 요약>`,
    `<나에 관한 페이지들>\n${lines.join("\n")}\n</나에 관한 페이지들>`,
    `<최근 기록>\n${me.records.slice(-10).join("\n")}\n</최근 기록>`,
  ].join("\n\n");
  const sys = await readFile("src/core/prompts/me-summary.md", "utf8");
  const { value } = await askJson<{ summary: string }>(
    sys,
    user,
    {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: { summary: { type: "string" } },
    },
    "me_summary",
  );
  const summary = value.summary.trim();
  if (!summary || summary === me.summary) return false;
  const md = buildMarkdown({
    page: { name: "나", aliasesToAdd: [], summary, newSections: [], replaces: [], records: [] },
    existing: me,
    sourceName: null,
    date: null,
    today,
  });
  await commitFiles(vaultOf(vault), [{ path: wikiPath("나"), content: md, mustExist: true }]);
  return true;
}

/** 새 페이지 이름들을 기존 페이지 본문에 소급해서 링크한다. 바뀐 파일 수를 돌려준다. */
async function applyRetroLinks(
  vault: string,
  wiki: Map<string, WikiPage>,
  newNames: string[],
  skip: Set<string>,
  today: string,
): Promise<number> {
  const targets = [...wiki.values()].filter((p) => !skip.has(normalizeTitle(p.name)));
  const hits = retroLink(targets, newNames);
  const writes: FileWrite[] = hits.map(({ page, content, summary }) => ({
    path: wikiPath(page.name),
    content: buildMarkdown({
      page: {
        name: page.name,
        aliasesToAdd: [],
        summary,
        newSections: [],
        replaces: [...content].map(([heading, c]) => ({ heading, content: c })),
        records: [],
      },
      existing: page,
      sourceName: null,
      date: null,
      today,
    }),
    mustExist: true,
  }));
  await commitFiles(vaultOf(vault), writes);
  return writes.length;
}

/** 정리할 항목 하나 — 볼트 노트이거나 `sources/` 의 원본이다. */
type Item = {
  /** sync_state 의 키. 볼트 기준 상대경로. */
  key: string;
  /** 기록 줄의 링크 이름. 노트는 파일명, 원본은 `@파일명`. */
  name: string;
  /** AI 에게 넘기고 quote 를 대조할 본문. */
  body: string;
  date: string | null;
  hash: string;
  /** 원본이면 같은 트랜잭션에서 쓸 출처 페이지. */
  sourcePage?: FileWrite;
  /** 입력 벽에 걸린 이유. 있으면 건너뛴다. */
  wall?: string;
};

async function collectItems(args: Args, today: string): Promise<Item[]> {
  const items: Item[] = [];

  const v = vaultOf(args.vault);
  for (const path of await scanNotes(v)) {
    const wall = await inputWall(v, path);
    if (wall) {
      items.push({ key: path, name: "", body: "", date: null, hash: "", wall });
      continue;
    }
    items.push(await readItem(v, path));
  }

  for (const src of await scanSources(v)) {
    const wall = await inputWall(v, src.path);
    if (wall) {
      items.push({ key: src.path, name: "", body: "", date: null, hash: "", wall });
      continue;
    }
    const rawHash = await rawHashOf(v, src);
    // 입력 벽 7 — 출처 페이지의 raw_hash 가 같으면 이미 처리한 원본이다. 추출도 안 한다.
    if (!args.force && (await readRawHash(v, src)) === rawHash) {
      items.push({ key: src.path, name: `@${src.name}`, body: "", date: null, hash: rawHash });
      continue;
    }
    let extracted;
    try {
      extracted = await extract(v, src);
    } catch (e: unknown) {
      // 입력 벽 8 — 텍스트가 0자면 스캔본이다. OCR 은 v1 범위 밖.
      const msg = e instanceof Error ? e.message : String(e);
      items.push({ key: src.path, name: "", body: "", date: null, hash: "", wall: msg });
      continue;
    }
    const date = await sourceDate(v, src, extracted.metaDate);
    const md = buildSourcePage({ src, rawHash, date, today, extracted });
    // AI 에게는 자료 본문만 넘긴다 — 출처 페이지의 프론트매터·H1·임베드 줄은 자료가 아니다.
    const body = src.path.endsWith(".pdf")
      ? extracted.pages.map((t, i) => `## ${i + 1}페이지\n\n${t}`).join("\n\n")
      : extracted.pages[0];
    items.push({
      key: src.path,
      name: `@${src.name}`,
      body,
      date,
      hash: rawHash,
      sourcePage: { path: `sources/@${src.name}.md`, content: md },
    });
  }

  // 날짜순으로 처리한다. 경로순이면 `독서/` 가 `일기/` 보다 먼저 와서 시간이 뒤섞이고,
  // 뒤에 만들어질 페이지의 사실이 앞 노트에서 빠진다.
  return items.sort(
    (a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.key.localeCompare(b.key),
  );
}

/** 본문이 상한을 넘으면 `## ` 헤딩 경계에서 나눈다. 헤딩이 없으면 그대로 한 덩어리다. */
function splitChunks(body: string, maxChars: number): string[] {
  if (body.length <= maxChars) return [body];
  const parts = body.split(/(?=^## )/m);
  const chunks: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur && cur.length + p.length > maxChars) {
      chunks.push(cur.trim());
      cur = "";
    }
    cur += p;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const today = localDate(new Date());

  console.log(`볼트: ${args.vault}`);
  console.log(
    `모델: ${args.dry ? "(호출 없음)" : MODELS.chat}${args.useEmbed ? ` + ${MODELS.embed}` : ""}${args.useBm25 ? " + BM25" : ""}`,
  );
  // 어느 판으로 쟀는지가 로그에 남아야 한다 — 프롬프트·정답 세트의 지문, 샘플링, 예산.
  const promptText = await readFile(args.prompt, "utf8");
  const evalText = await readFile(join(args.vault, "eval.json"), "utf8").catch(() => null);
  console.log(
    `설정: ${JSON.stringify(SETTINGS.sampling)} · 프롬프트 ${args.prompt} ${hash8(promptText)}` +
      `${evalText ? ` · eval.json ${hash8(evalText)}` : ""}${args.budget ? ` · 예산 $${args.budget}` : ""}`,
  );
  usage.limitUsd = args.budget;
  const balanceBefore = args.dry ? null : await balance();
  if (balanceBefore !== null) console.log(`잔액: $${balanceBefore.toFixed(2)}`);
  console.log("");

  const systemPrompt = await readFile(args.prompt, "utf8");
  if (args.prompt !== "src/core/prompts/write.md") console.log(`프롬프트: ${args.prompt}`);
  const state = await readSyncState(args.vault);

  // 소급 링크만 — 기존 볼트에 한 번 돌린다. 정리는 하지 않는다.
  if (args.relink) {
    const wiki = await loadWiki(vaultOf(args.vault));
    const names = [...wiki.values()].map((p) => p.name);
    const n = await applyRetroLinks(args.vault, wiki, names, new Set(), today);
    console.log(`소급 링크: ${n}장 갱신`);
    return;
  }

  // 출처가 사라졌으면 기록에 표시한다. 돌아왔으면 뗀다.
  if (!args.dry) await markDeletedSources(args.vault, state, today);

  let items = await collectItems(args, today);
  if (args.only) {
    const q = normalizeTitle(args.only);
    items = items.filter((it) => normalizeTitle(it.key).includes(q));
  }
  if (items.length === 0) {
    console.log("처리할 것이 없습니다.");
    return;
  }
  if (args.expect && items.length !== args.expect) {
    console.log(
      `항목 ${items.length}개 — --expect ${args.expect} 와 다릅니다. 호출하지 않고 멈춥니다.`,
    );
    process.exitCode = 1;
    return;
  }
  if (args.limit > 0) items = items.slice(0, args.limit);

  // 맞춤법 사전 — 깨진 낱말 되돌리기의 두 번째 겹. 못 열면 인용만 되돌린다.
  const isWord = args.dry ? undefined : await loadDictionary().catch(() => undefined);
  if (!args.dry && !isWord) console.log("! 맞춤법 사전을 못 열어 본문의 오타는 되돌리지 않습니다");

  let calls = 0;
  let cached = 0;
  let embedOk = args.useEmbed;
  const allIssues: string[] = [];
  // 예산 상한이나 스키마 실패가 잦으면 더 부르지 않는다. 처리 못 한 항목은 상태에 남기지 않아
  // 다음 실행이 그 장부터 이어받는다.
  let halted = false;
  let schemaFails = 0;

  for (const item of items) {
    if (halted) break;
    console.log(`── ${item.key}`);
    if (item.wall) {
      console.log(`   ! 입력벽 ${item.wall} — 건너뜁니다\n`);
      allIssues.push(`${item.key} 입력벽 ${item.wall}`);
      continue;
    }
    console.log(`   날짜 ${item.date ?? "(미상)"} · 본문 ${item.body.length}자`);

    // 입력 벽 7 — 이미 처리했고 내용이 그대로면 건너뛴다.
    const prev = state.notes[item.key];
    // --no-cache 는 응답 캐시만 끈다. 재개(sync_state)까지 끄면 실비 모델에서 처리한 장을 다시
    // 부른다 — 2026-09-16 실측, 한 장 $0.03 을 두 번 냈다. 다시 정리하려면 --force.
    if (prev && prev.hash === item.hash && !args.force) {
      console.log("   이미 처리했습니다 (해시 동일) — 건너뜁니다\n");
      continue;
    }

    if (!args.dry) await ensureMePage(args.vault, today);
    const chunks = splitChunks(item.body, args.maxChars);
    if (chunks.length > 1)
      console.log(`   ${args.maxChars}자를 넘어 ${chunks.length}청크로 나눕니다`);

    let itemFailed = false;
    for (let ci = 0; ci < chunks.length && !halted && !itemFailed; ci++) {
      const body = chunks[ci];
      const part = chunks.length > 1 ? `${ci + 1}/${chunks.length}` : null;
      // 다시 읽어 빌드하는 루프 — hashes 선행조건(결정 7 의 3단계). 데모는 단일 프로세스라
      // 두 번째 바퀴가 돌 일이 없지만, 앱 편집기가 들어오면 여기서 잡는다.
      for (let attempt = 0; ; attempt++) {
        const wiki = await loadWiki(vaultOf(args.vault));
        const snapshot = new Map(
          [...wiki.values()].map((p) => [
            normalizeTitle(p.name),
            JSON.stringify(p.fm.hashes ?? {}),
          ]),
        );

        // 노트가 바뀌어 다시 정리하는 경우 — 이 노트에서 나온 기록을 먼저 걷어낸다 (결정 10).
        // 기록은 출처에서 파생된 것이므로 출처가 바뀌면 다시 파생한다. 삭제(표시만)와 다르다.
        // 사용자가 기록 절을 고친 페이지는 건드리지 않는다. 청크가 여럿이면 첫 청크에서만.
        const stale = new Set<string>();
        if (ci === 0 && prev && (prev.hash !== item.hash || args.force)) {
          const tag = sourceTag(item.name);
          for (const page of wiki.values()) {
            if (!page.recordsOurs) continue;
            const kept = page.records.filter((r) => !tag.test(r));
            if (kept.length !== page.records.length) {
              page.records = kept;
              stale.add(normalizeTitle(page.name));
            }
          }
          if (stale.size && attempt === 0)
            console.log(`   다시 정리 — 기록을 걷어낸 페이지 ${stale.size}장`);
        }

        // 후보 추리기 — 글자 일치는 항상, 뜻 유사도는 --embed 일 때만, 낱말 겹침(BM25)은 --bm25 일 때만.
        // 임베딩이 막히면(한도 소진 등) 글자 일치만으로 계속 간다. 후보를 넓히는 보조
        // 수단 때문에 정리 자체가 멈추면 안 된다.
        let embedOpts;
        if (embedOk && wiki.size > 0) {
          try {
            const pages = [...wiki.values()];
            const vecs = await embed([body, ...pages.map(pageEmbedText)]);
            embedOpts = {
              noteVec: vecs[0],
              pageVecs: new Map(pages.map((p, i) => [p.name, vecs[i + 1]])),
              threshold: args.threshold,
              topN: args.topN,
            };
          } catch (e: unknown) {
            embedOk = false;
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`   ! 임베딩-불가 이후 글자 일치만 씁니다 — ${msg.slice(0, 120)}`);
            allIssues.push(`${item.key} 임베딩-불가`);
          }
        }

        const note = { key: item.key, name: item.name, body, hash: item.hash, date: item.date };
        const cands = pickCandidates(
          note,
          [...wiki.values()],
          embedOpts,
          args.useBm25 ? { topN: args.topN } : undefined,
        );
        if (attempt === 0) {
          if (cands.related.length) {
            const detail = cands.related
              .map((p) => {
                const sc = cands.score.get(p.name);
                return `${p.name}(${cands.why.get(p.name)}${sc === undefined ? "" : ` ${sc.toFixed(2)}`})`;
              })
              .join(", ");
            console.log(`   후보 ${cands.related.length}장: ${detail}`);
          } else {
            console.log(`   후보 없음 (위키 ${wiki.size}장)`);
          }
        }

        // `나` 의 요약이 오래됐으면 알린다. "큰 그림이 바뀔 때만 고쳐라" 를 AI 는 "절대 고치지
        // 마라" 로 받는다 — 87장 뒤에도 첫 노트의 요약이 그대로였다(23회차). 낡은 요약은
        // 페이지를 열어도 안 보이는 오류라 코드가 세어서 보이게 한다.
        const hints = new Map<string, string>();
        if ((state.me?.age ?? 0) >= 15) {
          hints.set(
            "나",
            `이 요약은 노트 ${state.me!.age}장 전에 쓴 것입니다. 지금의 나와 맞지 않으면 다시 쓰십시오`,
          );
        }
        const userMessage = buildUserMessage(note, cands, part, hints);

        if (args.dry) {
          console.log("\n" + "─".repeat(70));
          console.log(userMessage);
          console.log("─".repeat(70) + "\n");
          break;
        }

        // 같은 입력이면 캐시에서 온다 — 선행조건 재시도가 AI 를 다시 부르지 않는 이유.
        let res: Awaited<ReturnType<typeof writeWiki>>;
        try {
          res = await writeWiki(systemPrompt, userMessage, {
            noCache: args.noCache && attempt === 0,
          });
        } catch (e: unknown) {
          if (e instanceof BudgetExceeded) {
            console.log(`   ! ${e.message}`);
            halted = true;
            break;
          }
          // 형식 불량(JSON 아님·빈 응답)은 이 장만 건너뛴다. 한 장 때문에 서른 장 실행이 죽지 않게.
          // 잦으면 모델이나 스키마 문제이므로 멈춘다.
          if (e instanceof SyntaxError || (e instanceof Error && e.message.startsWith("빈 응답"))) {
            schemaFails++;
            console.log(`   ! 스키마-실패 — ${e.message.slice(0, 120)} → 이 노트를 건너뜁니다`);
            allIssues.push(`${item.key} 스키마-실패`);
            if (schemaFails > 2) halted = true;
            itemFailed = true;
            break;
          }
          throw e;
        }
        if (attempt === 0) {
          if (res.cached) cached++;
          else calls++;
          console.log(
            `   AI ${res.cached ? "(캐시)" : "호출"} (입력 ${userMessage.length}자) → 페이지 ${res.pages.length}장`,
          );
          if (!res.cached && usage.last) console.log(`   ${usage.last}`);
        }

        const verified = verify({
          llmPages: res.pages,
          sourceBody: body,
          names: nameIndex(wiki.values()),
          existing: wiki,
          vocabTexts: items.map((it) => it.body),
          isWord,
        });

        if (attempt === 0) {
          for (const i of verified.issues) {
            console.log(`   ! ${i.kind} [${i.page}] ${i.detail}`);
            allIssues.push(`${item.key} ${i.kind} [${i.page}] ${i.detail}`);
          }
        }

        const writes: FileWrite[] = [];
        const logs: string[] = [];
        if (ci === 0 && item.sourcePage) {
          // 출처 페이지는 위키와 같은 트랜잭션에서 쓴다. 먼저 쓰고 실패하면 raw_hash 만 남아 영구 스킵된다.
          writes.push(item.sourcePage);
          logs.push(`   출처 sources/@${item.name.slice(1)}.md`);
        }
        for (const page of verified.pages) {
          const existing = wiki.get(normalizeTitle(page.name));
          if (!hasChanges(page)) {
            if (!existing) {
              // 출력 벽 1 — 검문 뒤 아무것도 안 남은 새 페이지는 만들지 않는다.
              logs.push(`   ! 빈-깡통 [${page.name}] 만들지 않았습니다`);
              allIssues.push(`${item.key} 빈-깡통 [${page.name}]`);
            } else {
              logs.push(`   변화 없음 [${page.name}] 쓰지 않았습니다`);
            }
            continue;
          }
          const md = buildMarkdown({
            page,
            existing,
            sourceName: item.name,
            date: item.date,
            today,
          });
          writes.push({
            path: existing?.path ?? wikiPath(page.name),
            content: md,
            mustExist: !!existing,
          });
          logs.push(
            `   ${existing ? "갱신" : "생성"} wiki/${safeFileName(page.name)}.md (기록 ${page.records.length}, 링크 ${countBodyLinks(md)})`,
          );
          stale.delete(normalizeTitle(page.name));
        }
        // 기록을 걷어냈는데 이번 결과에 없는 페이지 — 걷어낸 상태 그대로 써서 남긴다.
        // 단 AI 가 아무것도 안 냈으면(페이지 0장) 걷어내지 않는다 — 옛 기록만 사라지고 새
        // 기록은 안 들어온다 (2026-09-17 실측: 다시 정리한 노트에서 기록 3줄이 그냥 없어졌다).
        if (verified.pages.length === 0 && stale.size) {
          logs.push(`   AI 가 낸 것이 없어 옛 기록 ${stale.size}장을 그대로 둡니다`);
          stale.clear();
        }
        for (const key of stale) {
          const existing = wiki.get(key)!;
          writes.push({
            path: existing.path,
            content: rebuildRecordsOnly(existing, today),
            mustExist: true,
          });
          logs.push(`   정리 wiki/${safeFileName(existing.name)}.md (이 노트의 옛 기록을 뺌)`);
        }

        // 선행조건 — 쓰기 직전에 대상 페이지를 다시 읽어 hashes 가 그대로인지 본다.
        // 다르면 누군가(앱 편집기) 그 사이에 고친 것이다. 새 판 위에 빌더를 다시 돌린다.
        let changed = false;
        for (const w of writes) {
          if (!w.mustExist || !w.path.startsWith("wiki/")) continue;
          const fresh = await readWikiPage(vaultOf(args.vault), w.path).catch(() => null);
          if (
            fresh &&
            JSON.stringify(fresh.fm.hashes ?? {}) !== snapshot.get(normalizeTitle(fresh.name))
          )
            changed = true;
        }
        if (changed) {
          if (attempt >= 2) {
            console.log("   ! 선행조건 3회 실패 — 이 항목은 보류합니다");
            allIssues.push(`${item.key} 선행조건-실패`);
            break;
          }
          console.log("   선행조건 — 쓰기 직전에 파일이 바뀌어 다시 빌드합니다");
          continue;
        }

        await commitFiles(vaultOf(args.vault), writes);
        for (const l of logs) console.log(l);

        // 이번 호출에서 새로 생긴 페이지 — 이미 쓰인 페이지 본문에 글자로 있으면 링크로 바꾼다.
        const created = verified.pages
          .filter((pg) => !wiki.has(normalizeTitle(pg.name)) && hasChanges(pg))
          .map((pg) => pg.name);
        if (created.length) {
          const written = new Set(verified.pages.map((pg) => normalizeTitle(pg.name)));
          const n = await applyRetroLinks(args.vault, wiki, created, written, today);
          if (n) console.log(`   소급 링크 ${n}장 (${created.join(", ")})`);
        }
        break;
      }
    }

    if (halted || itemFailed) {
      console.log("");
      continue;
    }
    if (!args.dry) {
      state.notes[item.key] = { hash: item.hash, compiledAt: new Date().toISOString() };
      // `나` 요약의 나이 — 지문이 그대로면 한 장 더 늙는다.
      const me = (await loadWiki(vaultOf(args.vault))).get("나");
      const h = me ? hash8(me.summary) : "";
      state.me =
        state.me?.summaryHash === h
          ? { summaryHash: h, age: state.me.age + 1 }
          : { summaryHash: h, age: 0 };
      if (args.meEvery > 0 && state.me.age >= args.meEvery) {
        if (await refreshMeSummary(args.vault, today)) {
          calls++;
          const fresh = (await loadWiki(vaultOf(args.vault))).get("나");
          state.me = { summaryHash: fresh ? hash8(fresh.summary) : "", age: 0 };
          console.log(`   나 요약 갱신: ${fresh?.summary.slice(0, 80)}`);
          if (usage.last) console.log(`   ${usage.last}`);
        } else {
          state.me = { summaryHash: h, age: 0 };
        }
      }
      // 항목마다 저장한다. 끝에서 한 번만 쓰면 중간에 죽었을 때 위키는 바뀌었는데
      // 상태는 안 남아, 다음 실행이 같은 노트를 다시 정리해 기록이 두 번 쌓인다.
      await writeSyncState(args.vault, state);
    }
    console.log("");
  }

  // 요약 — 링크 밀도는 사업계획서의 기준선 1.5 와 비교한다.
  const finalWiki = await loadWiki(vaultOf(args.vault));
  let links = 0;
  for (const p of await scanWiki(vaultOf(args.vault))) {
    links += countBodyLinks(await readFile(join(args.vault, p), "utf8"));
  }
  const density = finalWiki.size ? (links / finalWiki.size).toFixed(2) : "0";

  console.log("═".repeat(70));
  console.log(`위키 ${finalWiki.size}장 · 링크 ${links}개 · 문서당 ${density} (기준선 1.5)`);
  console.log(
    `AI 호출 ${calls}회 · 캐시 ${cached}회 · 임베딩 ${embedStats.sent}항목 · 지적 ${allIssues.length}건 · ${usageSummary()}`,
  );
  // 지적을 종류별로 — 오타-되돌림 수가 곧 모델이 깨뜨린 낱말 수다.
  const byKind = new Map<string, number>();
  for (const line of allIssues) {
    const kind = line.split(" ")[1] ?? "?";
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  if (byKind.size) console.log(`지적: ${[...byKind].map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  const balanceAfter = balanceBefore === null ? null : await balance();
  if (balanceBefore !== null && balanceAfter !== null) {
    const spent = (balanceBefore - balanceAfter).toFixed(3);
    console.log(
      // 차감은 몇 분 뒤에 반영되기도 한다. 다음 실행의 시작 잔액이 진짜 값이다.
      `잔액: $${balanceBefore.toFixed(2)} → $${balanceAfter.toFixed(2)} (차감 $${spent} · 반영 지연 가능)`,
    );
  }
  if (finalWiki.size) {
    console.log(`\n만들어진 페이지: ${[...finalWiki.values()].map((p) => p.name).join(", ")}`);
  }
}

main().catch((e: unknown) => {
  console.error("\n실패:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
