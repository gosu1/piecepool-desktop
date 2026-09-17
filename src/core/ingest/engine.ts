// 정리 엔진 — 항목 하나를 끝까지 관통한다. scripts/demo/index.ts 의 실측 흐름을 옮겨 왔다
// (2026-09-17, 4단계). 진행 상황은 onProgress 로만 나간다 — 엔진은 CLI 인지 앱인지 모른다.
//
//   후보 추리기 → AI 호출(JSON) → 검문 → 빌더 → hashes 선행조건 → 트랜잭션 → 소급 링크 → 상태 저장
//
// git 은 여기 없다. 봉인·커밋은 agent/tasks/ingest.ts 가 이 엔진 앞뒤에서 한다.
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import type { NotePath, OnProgress, Vault } from "../../shared/types.ts";
import type { Written } from "../agent/written.ts";
import type { IngestSource } from "../agent/tasks/ingest.ts";
import { PiecePoolError } from "../errors.ts";
import { normalizeTitle } from "../index/links.ts";
import * as chat from "../llm/chat.ts";
import { type CallUsage, LlmFormatError, type LlmPage, usageLine } from "../llm/chat.ts";
import { loadPrompt } from "../prompts/load.ts";
import { buildMarkdown, hasChanges, nameIndex, retroLink, safeFileName, verify } from "./build.ts";
import { buildUserMessage, pickCandidates } from "./prompt.ts";
import {
  buildSourcePage,
  extract,
  inputWall,
  rawHashOf,
  readRawHash,
  scanSources,
  sourceDate,
  type SourceFile,
} from "./source.ts";
import { loadDictionary } from "./spell.ts";
import { copyIntoSources } from "./store.ts";
import { commitFiles, type FileWrite } from "./tx.ts";
import {
  hash8,
  type Item,
  loadWiki,
  localDate,
  readItem,
  readWikiPage,
  scanNotes,
  type WikiPage,
} from "./wiki.ts";

/** AI 호출 둘. 기본은 llm/chat 의 실제 클라이언트 — 테스트가 가짜를 넣는다. */
export interface Llm {
  writeWiki(system: string, user: string): Promise<{ pages: LlmPage[]; usage?: CallUsage }>;
  askJson<T>(
    system: string,
    user: string,
    schema: Record<string, unknown>,
    name: string,
  ): Promise<{ value: T; usage?: CallUsage }>;
}

export interface EngineOptions {
  onProgress?: OnProgress;
  llm?: Llm;
  /** 이미 처리한 항목도 다시 정리한다 (결정 10 의 재정리 경로). */
  force?: boolean;
  /** BM25 후보 상한. 실측 기본 8 (ADR-0002 결정 3). */
  topN?: number;
  /** `나` 요약을 이 장수마다 별도 호출로 다시 쓴다. 0 이면 안 한다. */
  meEvery?: number;
  /** 이 글자 수까지는 통째로 한 번에 넘긴다. 넘으면 헤딩 경계로 나눠 청크마다 부른다. */
  maxChars?: number;
}

/** 정리할 항목 하나. wall 이 있으면 건너뛴다. */
export type EngineItem = Item & {
  /** 원본이면 같은 트랜잭션에서 쓸 출처 페이지. */
  sourcePage?: FileWrite;
  /** 입력 벽에 걸린 이유. */
  wall?: string;
};

export type ItemOutcome =
  | { status: "done"; issues: string[] }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

/** 처리한 항목의 지문. `missing` 은 원본이 사라져 기록에 `(출처 삭제됨)` 을 붙인 상태. */
type SyncEntry = { hash: string; compiledAt: string; missing?: true };
export type SyncState = {
  notes: Record<string, SyncEntry>;
  /** `나` 요약의 지문과, 그 지문이 유지된 동안 처리한 항목 수. */
  me?: { summaryHash: string; age: number };
};

const SYNC_STATE: NotePath = ".piecepool/sync_state.json";

export async function readSyncState(v: Vault): Promise<SyncState> {
  try {
    return JSON.parse(await readFile(join(v.root, SYNC_STATE), "utf8")) as SyncState;
  } catch {
    return { notes: {} };
  }
}

/** 상태는 위키와 같은 커밋에 들어가야 한다 — 되돌리면 상태도 함께 돌아가야 그 노트가 다시 정리된다. */
async function writeSyncState(v: Vault, st: SyncState, written: Written): Promise<void> {
  await commitFiles(v, [{ path: SYNC_STATE, content: JSON.stringify(st, null, 2) + "\n" }]);
  written.add(SYNC_STATE);
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function wikiPath(name: string): NotePath {
  return `wiki/${safeFileName(name)}.md`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 기록 줄이 이 출처를 가리키는가. `← [[이름]]` 또는 `← [[이름#절]]`. */
function sourceTag(name: string): RegExp {
  return new RegExp(`← \\[\\[${escapeRe(name)}(\\]\\]|#)`);
}

/** 본문 링크 개수(고유 대상). 진행 로그용 — 사업계획서 기준선 1.5 와 비교하는 그 숫자다. */
function countBodyLinks(markdown: string): number {
  const body = markdown.replace(/^---[\s\S]*?\r?\n---\r?\n/, "").replace(/^## 기록[\s\S]*$/m, "");
  const names = (body.match(/\[\[[^\]]+\]\]/g) ?? []).map((m) =>
    m.slice(2, -2).split("|")[0].split("#")[0].trim().toLowerCase(),
  );
  return new Set(names).size;
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

/**
 * `wiki/나.md` 가 없으면 만든다. '나' 에 관한 페이지들의 목차이고 고정 허브다 (결정 11).
 * 초기 요약에도 지문을 찍는다 — 없으면 "지문 없음 = 사용자 편집" 규칙에 걸려 AI 가 영영 못 고친다.
 */
async function ensureMePage(v: Vault, today: string, written: Written): Promise<void> {
  const path = wikiPath("나");
  if (await exists(join(v.root, path))) return;
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
  await commitFiles(v, [{ path, content: md }]);
  written.add(path);
}

const DELETED_MARK = " (출처 삭제됨)";

/**
 * 출처가 사라졌거나 돌아왔을 때 기록 줄의 표시를 붙이거나 뗀다. 지우지 않는다 —
 * 의도를 모르면 파괴하지 않는다. 사용자가 기록 절을 고친 페이지는 건드리지 않는다.
 */
export async function markDeletedSources(
  v: Vault,
  state: SyncState,
  today: string,
  written: Written,
  onProgress?: OnProgress,
): Promise<void> {
  const changes: { key: string; name: string; missing: boolean }[] = [];
  for (const [key, entry] of Object.entries(state.notes)) {
    const present = await exists(join(v.root, key));
    const name = key.startsWith("sources/")
      ? "@" + key.slice("sources/".length).replace(/\.[^.]+$/, "")
      : key.startsWith(".piecepool/sessions/")
        ? "@session-" + key.slice(".piecepool/sessions/".length).replace(/\.[^.]+$/, "")
        : key.replace(/^.*\//, "").replace(/\.[^.]+$/, "");
    if (!present && !entry.missing) changes.push({ key, name, missing: true });
    if (present && entry.missing) changes.push({ key, name, missing: false });
  }
  if (!changes.length) return;

  const wiki = await loadWiki(v);
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
    if (touched) {
      writes.push({ path: page.path, content: rebuildRecordsOnly(page, today), mustExist: true });
    }
  }
  await commitFiles(v, writes);
  for (const w of writes) written.add(w.path);
  for (const c of changes) {
    if (c.missing) state.notes[c.key].missing = true;
    else delete state.notes[c.key].missing;
    onProgress?.({
      step: "출처",
      detail: `${c.missing ? "삭제됨" : "복구됨"}: ${c.key} → 기록 ${writes.length}장에 표시`,
    });
  }
  await writeSyncState(v, state, written);
}

/**
 * `나` 요약을 다시 쓴다 — 노트 한 장의 호출로는 "지금의 나" 를 쓸 재료가 없다 (87장 뒤에도
 * 첫 노트의 요약이 그대로였다). N장마다 한 번, `나` 가 가리키는 페이지들의 요약을 모아 작은
 * 별도 호출로 쓴다. 소스당 1회 원칙에 1/N 을 얹는다.
 */
async function refreshMeSummary(
  v: Vault,
  today: string,
  llm: Llm,
  written: Written,
): Promise<{ summary: string; usage?: CallUsage } | null> {
  const wiki = await loadWiki(v);
  const me = wiki.get("나");
  if (!me) return null;
  const sumSec = me.sections.find((s) => s.heading === "요약");
  if (sumSec && !sumSec.ours) return null; // 사용자가 고친 요약은 건드리지 않는다
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
  const { value, usage } = await llm.askJson<{ summary: string }>(
    await loadPrompt("me-summary"),
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
  if (!summary || summary === me.summary) return null;
  const md = buildMarkdown({
    page: { name: "나", aliasesToAdd: [], summary, newSections: [], replaces: [], records: [] },
    existing: me,
    sourceName: null,
    date: null,
    today,
  });
  await commitFiles(v, [{ path: me.path, content: md, mustExist: true }]);
  written.add(me.path);
  return { summary, usage };
}

/** 새 페이지 이름들을 기존 페이지 본문에 소급해서 링크한다. 바뀐 파일 수를 돌려준다. */
async function applyRetroLinks(
  v: Vault,
  wiki: Map<string, WikiPage>,
  newNames: string[],
  skip: Set<string>,
  today: string,
  written: Written,
): Promise<number> {
  const targets = [...wiki.values()].filter((p) => !skip.has(normalizeTitle(p.name)));
  const writes: FileWrite[] = retroLink(targets, newNames).map(({ page, content, summary }) => ({
    path: page.path,
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
  await commitFiles(v, writes);
  for (const w of writes) written.add(w.path);
  return writes.length;
}

/** `sources/` 원본 하나를 항목으로. 입력 벽 4~8 과 raw_hash 중복 검사를 여기서 한다. */
async function sourceItem(
  v: Vault,
  src: SourceFile,
  today: string,
  force: boolean,
): Promise<EngineItem> {
  const wall = await inputWall(v, src.path);
  if (wall) return { key: src.path, name: "", body: "", date: null, hash: "", wall };
  const rawHash = await rawHashOf(v, src);
  // 입력 벽 7 — 출처 페이지의 raw_hash 가 같으면 이미 처리한 원본이다. 추출도 안 한다.
  if (!force && (await readRawHash(v, src)) === rawHash) {
    return { key: src.path, name: `@${src.name}`, body: "", date: null, hash: rawHash };
  }
  let extracted;
  try {
    extracted = await extract(v, src);
  } catch (e: unknown) {
    // 입력 벽 8 — 텍스트가 0자면 스캔본이다. OCR 은 v1 범위 밖.
    if (e instanceof PiecePoolError && e.kind === "parse_failed") {
      return { key: src.path, name: "", body: "", date: null, hash: "", wall: e.message };
    }
    throw e;
  }
  const date = await sourceDate(v, src, extracted.metaDate);
  const md = buildSourcePage({ src, rawHash, date, today, extracted });
  // AI 에게는 자료 본문만 넘긴다 — 출처 페이지의 프론트매터·H1·임베드 줄은 자료가 아니다.
  // PDF 는 `## N페이지` 헤딩을 살린다: 기록 줄의 앵커가 그 헤딩이다.
  const body =
    extname(src.path) === ".pdf"
      ? extracted.pages.map((t, i) => `## ${i + 1}페이지\n\n${t}`).join("\n\n")
      : extracted.pages[0];
  return {
    key: src.path,
    name: `@${src.name}`,
    body,
    date,
    hash: rawHash,
    sourcePage: { path: `sources/@${src.name}.md`, content: md },
  };
}

async function noteItem(v: Vault, path: NotePath): Promise<EngineItem> {
  const wall = await inputWall(v, path);
  if (wall) return { key: path, name: "", body: "", date: null, hash: "", wall };
  return await readItem(v, path);
}

/** 볼트의 정리 대상 전부 — 노트와 `sources/` 원본과 세션 로그. 날짜순. */
export async function collectItems(v: Vault, today: string, force = false): Promise<EngineItem[]> {
  const items: EngineItem[] = [];
  for (const path of await scanNotes(v)) items.push(await noteItem(v, path));
  for (const src of await scanSources(v)) items.push(await sourceItem(v, src, today, force));
  // 날짜순으로 처리한다. 경로순이면 `독서/` 가 `일기/` 보다 먼저 와서 시간이 뒤섞이고,
  // 뒤에 만들어질 페이지의 사실이 앞 노트에서 빠진다.
  return items.sort(
    (a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.key.localeCompare(b.key),
  );
}

/**
 * IngestSource 하나를 항목으로. 볼트 밖 파일은 `sources/` 로 복사한다(복사본 경로를 written 에 넣는다).
 * 볼트 안 경로면 그 노트(또는 그 원본)다. 세션은 로그 본문이 곧 자료다.
 */
export async function itemFromSource(
  v: Vault,
  src: IngestSource,
  today: string,
  written: Written,
  force = false,
): Promise<EngineItem> {
  if (src.kind === "session") {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src.log.trim());
    const body = m ? src.log.trim().slice(m[0].length).trim() : src.log.trim();
    const date = (m && /^date:\s*(\d{4}-\d{2}-\d{2})/m.exec(m[1])?.[1]) || today;
    const s: SourceFile = {
      path: `.piecepool/sessions/${src.id}.md`,
      name: `session-${src.id}`,
      session: true,
    };
    const rawHash = hash8(src.log);
    const md = buildSourcePage({
      src: s,
      rawHash,
      date,
      today,
      extracted: { pages: [body], metaDate: date },
    });
    return {
      key: s.path,
      name: `@${s.name}`,
      body,
      date,
      hash: rawHash,
      sourcePage: { path: `sources/@${s.name}.md`, content: md },
    };
  }
  let rel: string;
  try {
    rel = relative(await realpath(v.root), await realpath(resolve(src.path)));
  } catch {
    throw new PiecePoolError("vault_not_found", `파일을 찾지 못했다: ${src.path}`);
  }
  const inside = rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
  let path: NotePath;
  if (inside) {
    path = rel.split(sep).join("/");
  } else {
    path = await copyIntoSources(v, src.path);
    written.add(path);
  }
  if (path.startsWith("sources/")) {
    const s: SourceFile = { path, name: basename(path, extname(path)) };
    return await sourceItem(v, s, today, force);
  }
  return await noteItem(v, path);
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

/** 한 실행 동안 고정인 것들. 항목마다 다시 만들지 않는다 (사전 열기 0.7초). */
export interface Context {
  llm: Llm;
  systemPrompt: string;
  /** 깨진 낱말 사전의 어휘 — 볼트 노트 본문 전부. */
  vocabTexts: string[];
  /** 맞춤법 사전. 못 열면 undefined — 본문의 오타는 되돌리지 않는다. */
  isWord?: (run: string) => boolean;
  state: SyncState;
  today: string;
  onProgress?: OnProgress;
  force: boolean;
  topN: number;
  meEvery: number;
  maxChars: number;
  /** 형식 불량이 잦으면 멈춘다 — 모델이나 스키마 문제다. */
  schemaFails: number;
}

export async function makeContext(v: Vault, o: EngineOptions = {}): Promise<Context> {
  const notes = await scanNotes(v);
  const vocabTexts: string[] = [];
  for (const p of notes) vocabTexts.push((await readItem(v, p)).body);
  const isWord = await loadDictionary().catch(() => undefined);
  if (!isWord)
    o.onProgress?.({ step: "사전", detail: "맞춤법 사전을 못 열어 본문의 오타는 되돌리지 않는다" });
  return {
    llm: o.llm ?? chat,
    systemPrompt: await loadPrompt("write"),
    vocabTexts,
    isWord,
    state: await readSyncState(v),
    today: localDate(new Date()),
    onProgress: o.onProgress,
    force: o.force ?? false,
    topN: o.topN ?? 8,
    meEvery: o.meEvery ?? 20,
    maxChars: o.maxChars ?? 200_000,
    schemaFails: 0,
  };
}

/**
 * 항목 하나를 정리한다. 쓴 경로는 전부 written 에 들어간다.
 * 실패한 항목은 상태에 남기지 않아 다음 실행이 그 장부터 이어받는다.
 */
export async function processItem(
  v: Vault,
  item: EngineItem,
  ctx: Context,
  written: Written,
): Promise<ItemOutcome> {
  const say = (step: string, detail?: string) => ctx.onProgress?.({ step, detail });
  if (item.wall) {
    say("건너뜀", `입력벽 ${item.wall}`);
    return { status: "skipped", reason: `입력벽 ${item.wall}` };
  }
  // 입력 벽 7 — 이미 처리했고 내용이 그대로면 건너뛴다.
  const prev = ctx.state.notes[item.key];
  if (prev && prev.hash === item.hash && !ctx.force) {
    say("건너뜀", "이미 처리했다 (해시 동일)");
    return { status: "skipped", reason: "이미 처리했다" };
  }
  say("항목", `${item.key} · 날짜 ${item.date ?? "(미상)"} · 본문 ${item.body.length}자`);

  await ensureMePage(v, ctx.today, written);
  const chunks = splitChunks(item.body, ctx.maxChars);
  if (chunks.length > 1) say("청크", `${ctx.maxChars}자를 넘어 ${chunks.length}청크로 나눈다`);
  const issues: string[] = [];

  for (let ci = 0; ci < chunks.length; ci++) {
    const body = chunks[ci];
    const part = chunks.length > 1 ? `${ci + 1}/${chunks.length}` : null;

    // 후보 추리기 — 글자 일치 ∪ BM25 상위 N (결정 3). 호출 전 위키 기준.
    const wikiBefore = await loadWiki(v);
    const cands = pickCandidates({ ...item, body }, [...wikiBefore.values()], undefined, {
      topN: ctx.topN,
    });
    say(
      "후보",
      cands.related.length
        ? cands.related
            .map((p) => {
              const sc = cands.score.get(p.name);
              return `${p.name}(${cands.why.get(p.name)}${sc === undefined ? "" : ` ${sc.toFixed(2)}`})`;
            })
            .join(", ")
        : `없음 (위키 ${wikiBefore.size}장)`,
    );
    // `나` 의 요약이 오래됐으면 알린다. 낡은 요약은 페이지를 열어도 안 보이는 오류라 코드가 세어서 보이게 한다.
    const hints = new Map<string, string>();
    if ((ctx.state.me?.age ?? 0) >= 15) {
      hints.set(
        "나",
        `이 요약은 노트 ${ctx.state.me!.age}장 전에 쓴 것입니다. 지금의 나와 맞지 않으면 다시 쓰십시오`,
      );
    }
    const userMessage = buildUserMessage({ ...item, body }, cands, part, hints);

    let pages: LlmPage[];
    try {
      const res = await ctx.llm.writeWiki(ctx.systemPrompt, userMessage);
      pages = res.pages;
      say(
        "AI",
        `입력 ${userMessage.length}자 → 페이지 ${pages.length}장${res.usage ? ` · ${usageLine(res.usage)}` : ""}`,
      );
    } catch (e: unknown) {
      // 형식 불량(JSON 아님·빈 응답)은 이 장만 건너뛴다. 한 장 때문에 서른 장 실행이 죽지 않게.
      if (e instanceof LlmFormatError) {
        ctx.schemaFails++;
        say("건너뜀", `스키마-실패 — ${e.message.slice(0, 120)}`);
        return { status: "failed", reason: `스키마-실패 ${e.message.slice(0, 120)}` };
      }
      throw e;
    }

    // 다시 읽어 빌드하는 루프 — hashes 선행조건(결정 7 의 3단계). 앱 편집기가 그 사이에
    // 페이지를 고치면 새 판 위에 빌더를 다시 돌린다. AI 를 다시 부르지 않는다.
    for (let attempt = 0; ; attempt++) {
      const wiki = await loadWiki(v);
      const snapshot = new Map(
        [...wiki.values()].map((p) => [normalizeTitle(p.name), JSON.stringify(p.fm.hashes ?? {})]),
      );

      // 노트가 바뀌어 다시 정리하는 경우 — 이 노트에서 나온 기록을 먼저 걷어낸다 (결정 10).
      // 사용자가 기록 절을 고친 페이지는 건드리지 않는다. 청크가 여럿이면 첫 청크에서만.
      const stale = new Set<string>();
      if (ci === 0 && prev && (prev.hash !== item.hash || ctx.force)) {
        const tag = sourceTag(item.name);
        for (const page of wiki.values()) {
          if (!page.recordsOurs) continue;
          const kept = page.records.filter((r) => !tag.test(r));
          if (kept.length !== page.records.length) {
            page.records = kept;
            stale.add(normalizeTitle(page.name));
          }
        }
        if (stale.size && attempt === 0) say("다시 정리", `기록을 걷어낸 페이지 ${stale.size}장`);
      }

      const verified = verify({
        llmPages: pages,
        sourceBody: body,
        names: nameIndex(wiki.values()),
        existing: wiki,
        vocabTexts: ctx.vocabTexts,
        isWord: ctx.isWord,
      });
      if (attempt === 0) {
        for (const i of verified.issues) {
          say("지적", `${i.kind} [${i.page}] ${i.detail}`);
          issues.push(`${i.kind} [${i.page}] ${i.detail}`);
        }
      }

      const writes: FileWrite[] = [];
      const logs: string[] = [];
      if (ci === 0 && item.sourcePage) {
        // 출처 페이지는 위키와 같은 트랜잭션에서 쓴다. 먼저 쓰고 실패하면 raw_hash 만 남아 영구 스킵된다.
        writes.push(item.sourcePage);
        logs.push(`출처 ${item.sourcePage.path}`);
      }
      for (const page of verified.pages) {
        const existing = wiki.get(normalizeTitle(page.name));
        if (!hasChanges(page)) {
          if (!existing) {
            // 출력 벽 1 — 검문 뒤 아무것도 안 남은 새 페이지는 만들지 않는다.
            logs.push(`빈-깡통 [${page.name}] 만들지 않았다`);
            issues.push(`빈-깡통 [${page.name}]`);
          } else {
            logs.push(`변화 없음 [${page.name}]`);
          }
          continue;
        }
        const md = buildMarkdown({
          page,
          existing,
          sourceName: item.name,
          date: item.date,
          today: ctx.today,
        });
        writes.push({
          path: existing?.path ?? wikiPath(page.name),
          content: md,
          mustExist: !!existing,
        });
        logs.push(
          `${existing ? "갱신" : "생성"} ${existing?.path ?? wikiPath(page.name)} (기록 ${page.records.length}, 링크 ${countBodyLinks(md)})`,
        );
        stale.delete(normalizeTitle(page.name));
      }
      // 기록을 걷어냈는데 이번 결과에 없는 페이지 — 걷어낸 상태 그대로 써서 남긴다.
      // 단 AI 가 아무것도 안 냈으면 걷어내지 않는다 — 옛 기록만 사라지고 새 기록은 안 들어온다.
      if (verified.pages.length === 0 && stale.size) {
        logs.push(`AI 가 낸 것이 없어 옛 기록 ${stale.size}장을 그대로 둔다`);
        stale.clear();
      }
      for (const key of stale) {
        const existing = wiki.get(key)!;
        writes.push({
          path: existing.path,
          content: rebuildRecordsOnly(existing, ctx.today),
          mustExist: true,
        });
        logs.push(`정리 ${existing.path} (이 노트의 옛 기록을 뺌)`);
      }

      // 선행조건 — 쓰기 직전에 대상 페이지를 다시 읽어 hashes 가 그대로인지 본다.
      let changed = false;
      for (const w of writes) {
        if (!w.mustExist || !w.path.startsWith("wiki/")) continue;
        const fresh = await readWikiPage(v, w.path).catch(() => null);
        if (
          fresh &&
          JSON.stringify(fresh.fm.hashes ?? {}) !== snapshot.get(normalizeTitle(fresh.name))
        ) {
          changed = true;
        }
      }
      if (changed) {
        if (attempt >= 2) {
          say("보류", "선행조건 3회 실패 — 이 항목은 보류한다");
          return { status: "failed", reason: "선행조건-실패" };
        }
        say("선행조건", "쓰기 직전에 파일이 바뀌어 다시 빌드한다");
        continue;
      }

      await commitFiles(v, writes);
      for (const w of writes) written.add(w.path);
      for (const l of logs) say("쓰기", l);

      // 이번 호출에서 새로 생긴 페이지 — 이미 쓰인 페이지 본문에 글자로 있으면 링크로 바꾼다.
      const created = verified.pages
        .filter((pg) => !wiki.has(normalizeTitle(pg.name)) && hasChanges(pg))
        .map((pg) => pg.name);
      if (created.length) {
        const skip = new Set(verified.pages.map((pg) => normalizeTitle(pg.name)));
        const n = await applyRetroLinks(v, wiki, created, skip, ctx.today, written);
        if (n) say("소급 링크", `${n}장 (${created.join(", ")})`);
      }
      break;
    }
  }

  ctx.state.notes[item.key] = { hash: item.hash, compiledAt: new Date().toISOString() };
  // `나` 요약의 나이 — 지문이 그대로면 한 장 더 늙는다.
  const me = (await loadWiki(v)).get("나");
  const h = me ? hash8(me.summary) : "";
  ctx.state.me =
    ctx.state.me?.summaryHash === h
      ? { summaryHash: h, age: ctx.state.me.age + 1 }
      : { summaryHash: h, age: 0 };
  if (ctx.meEvery > 0 && ctx.state.me.age >= ctx.meEvery) {
    const fresh = await refreshMeSummary(v, ctx.today, ctx.llm, written);
    ctx.state.me = { summaryHash: fresh ? hash8(fresh.summary) : h, age: 0 };
    if (fresh)
      say(
        "나 요약",
        `${fresh.summary.slice(0, 80)}${fresh.usage ? ` · ${usageLine(fresh.usage)}` : ""}`,
      );
  }
  // 항목마다 저장한다. 끝에서 한 번만 쓰면 중간에 죽었을 때 위키는 바뀌었는데 상태는 안 남아,
  // 다음 실행이 같은 노트를 다시 정리한다.
  await writeSyncState(v, ctx.state, written);
  return { status: "done", issues };
}

/** 위키 요약 — 진행 로그 끝에 한 줄. 사업계획서의 기준선 1.5 와 비교하는 링크 밀도다. */
export async function wikiStats(v: Vault): Promise<{ pages: number; links: number }> {
  const wiki = await loadWiki(v);
  let links = 0;
  for (const p of wiki.values())
    links += countBodyLinks(await readFile(join(v.root, p.path), "utf8"));
  return { pages: wiki.size, links };
}
