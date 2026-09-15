// 데모 — 파이프라인을 끝까지 관통한다. ADR-0002 가 실제로 작동하는지 보기 위한 것이다.
//
//   node --env-file=.env scripts/demo/index.ts --dry
//   node --env-file=.env scripts/demo/index.ts --only "DETR"
//   node --env-file=.env scripts/demo/index.ts --embed
//
// ingest 엔진의 CLI 판이다. 앱에는 아직 안 꽂혀 있다 — 4단계에서 src/core/ 로 옮겨 꽂는다.

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hash8,
  localDate,
  normalizeTitle,
  readNote,
  readWikiPage,
  scanNotes,
  scanWiki,
  type WikiPage,
} from "./vault.ts";
import { buildUserMessage, pageEmbedText, pickCandidates } from "./prompt.ts";
import { MODELS, embed, embedStats, writeWiki } from "./llm.ts";
import { buildMarkdown, hasChanges, nameIndex, retroLink, safeFileName, verify } from "./build.ts";
import {
  buildSourcePage,
  extract,
  inputWall,
  rawHashOf,
  readRawHash,
  scanSources,
  sourceDate,
} from "./source.ts";
import { commitFiles, type FileWrite } from "./tx.ts";

type Args = {
  vault: string;
  dry: boolean;
  useEmbed: boolean;
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
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    vault: "fixtures/vault",
    dry: false,
    useEmbed: false,
    only: null,
    noCache: false,
    // 0.65 · 5 — 캐시된 임베딩으로 오프라인 계산(2026-09-15): 0.65 에서 재현율 86% · 정밀도 34%,
    // 0.70 에서 62% · 67%. "러닝머신·헬스장 → 달리기" 가 0.67~0.76 에 있어 0.70 이면 하나를 놓친다.
    threshold: 0.65,
    topN: 5,
    prompt: "src/core/prompts/write.md",
    maxChars: 200_000,
    relink: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--vault") a.vault = argv[++i];
    else if (k === "--dry") a.dry = true;
    else if (k === "--embed") a.useEmbed = true;
    else if (k === "--only") a.only = argv[++i];
    else if (k === "--no-cache") a.noCache = true;
    else if (k === "--threshold") a.threshold = Number(argv[++i]);
    else if (k === "--top") a.topN = Number(argv[++i]);
    else if (k === "--prompt") a.prompt = argv[++i];
    else if (k === "--max-chars") a.maxChars = Number(argv[++i]);
    else if (k === "--relink") a.relink = true;
  }
  return a;
}

/** 처리한 항목의 지문. `missing` 은 원본이 사라져 기록에 `(출처 삭제됨)` 을 붙인 상태. */
type SyncEntry = { hash: string; compiledAt: string; missing?: true };
type SyncState = { notes: Record<string, SyncEntry> };

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
  const file = join(vault, "wiki", "나.md");
  if (await exists(file)) return;
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
  await commitFiles([{ path: file, content: md }]);
  console.log("   wiki/나.md 를 만들었습니다 (허브)");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 기록 줄이 이 출처를 가리키는가. `← [[이름]]` 또는 `← [[이름#절]]`. */
function sourceTag(name: string): RegExp {
  return new RegExp(`← \\[\\[${escapeRe(name)}(\\]\\]|#)`);
}

async function loadWiki(vault: string): Promise<Map<string, WikiPage>> {
  const map = new Map<string, WikiPage>();
  for (const p of await scanWiki(vault)) {
    const page = await readWikiPage(vault, p);
    map.set(normalizeTitle(page.name), page);
  }
  return map;
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

function wikiPath(vault: string, name: string): string {
  return join(vault, "wiki", `${safeFileName(name)}.md`);
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

  const wiki = await loadWiki(vault);
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
        path: wikiPath(vault, page.name),
        content: rebuildRecordsOnly(page, today),
        mustExist: true,
      });
  }
  await commitFiles(writes);
  for (const c of changes) {
    if (c.missing) state.notes[c.key].missing = true;
    else delete state.notes[c.key].missing;
    console.log(
      `   출처 ${c.missing ? "삭제됨" : "복구됨"}: ${c.key} → 기록 ${writes.length}장에 표시`,
    );
  }
  await writeSyncState(vault, state);
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
    path: wikiPath(vault, page.name),
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
  await commitFiles(writes);
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

  for (const path of await scanNotes(args.vault)) {
    const wall = await inputWall(args.vault, path);
    if (wall) {
      items.push({ key: path, name: "", body: "", date: null, hash: "", wall });
      continue;
    }
    const note = await readNote(args.vault, path);
    items.push({ key: path, name: note.name, body: note.body, date: note.date, hash: note.hash });
  }

  for (const src of await scanSources(args.vault)) {
    const wall = await inputWall(args.vault, src.path);
    if (wall) {
      items.push({ key: src.path, name: "", body: "", date: null, hash: "", wall });
      continue;
    }
    const rawHash = await rawHashOf(args.vault, src);
    // 입력 벽 7 — 출처 페이지의 raw_hash 가 같으면 이미 처리한 원본이다. 추출도 안 한다.
    if (!args.noCache && (await readRawHash(args.vault, src)) === rawHash) {
      items.push({ key: src.path, name: `@${src.name}`, body: "", date: null, hash: rawHash });
      continue;
    }
    const extracted = await extract(args.vault, src);
    const chars = extracted.pages.reduce((a, p) => a + p.length, 0);
    if (chars === 0) {
      // 입력 벽 8 — 텍스트가 0자면 스캔본이다. OCR 은 v1 범위 밖.
      items.push({
        key: src.path,
        name: "",
        body: "",
        date: null,
        hash: "",
        wall: "parse_failed (텍스트 0자)",
      });
      continue;
    }
    const date = await sourceDate(args.vault, src, extracted.metaDate);
    const md = buildSourcePage({ src, rawHash, date, today, extracted });
    // AI 에게는 페이지 절만 넘긴다 — H1 과 임베드 줄은 자료가 아니다.
    const body =
      md.slice(md.indexOf("\n## ") + 1).trim() || md.replace(/^---[\s\S]*?\n---\n/, "").trim();
    items.push({
      key: src.path,
      name: `@${src.name}`,
      body,
      date,
      hash: rawHash,
      sourcePage: { path: join(args.vault, "sources", `@${src.name}.md`), content: md },
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
    `모델: ${args.dry ? "(호출 없음)" : MODELS.chat}${args.useEmbed ? ` + ${MODELS.embed}` : ""}`,
  );
  console.log("");

  const systemPrompt = await readFile(args.prompt, "utf8");
  if (args.prompt !== "src/core/prompts/write.md") console.log(`프롬프트: ${args.prompt}`);
  const state = await readSyncState(args.vault);

  // 소급 링크만 — 기존 볼트에 한 번 돌린다. 정리는 하지 않는다.
  if (args.relink) {
    const wiki = await loadWiki(args.vault);
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

  let calls = 0;
  let cached = 0;
  let embedOk = args.useEmbed;
  const allIssues: string[] = [];

  for (const item of items) {
    console.log(`── ${item.key}`);
    if (item.wall) {
      console.log(`   ! 입력벽 ${item.wall} — 건너뜁니다\n`);
      allIssues.push(`${item.key} 입력벽 ${item.wall}`);
      continue;
    }
    console.log(`   날짜 ${item.date ?? "(미상)"} · 본문 ${item.body.length}자`);

    // 입력 벽 7 — 이미 처리했고 내용이 그대로면 건너뛴다.
    const prev = state.notes[item.key];
    if (prev && prev.hash === item.hash && !args.noCache) {
      console.log("   이미 처리했습니다 (해시 동일) — 건너뜁니다\n");
      continue;
    }

    if (!args.dry) await ensureMePage(args.vault, today);
    const chunks = splitChunks(item.body, args.maxChars);
    if (chunks.length > 1)
      console.log(`   ${args.maxChars}자를 넘어 ${chunks.length}청크로 나눕니다`);

    for (let ci = 0; ci < chunks.length; ci++) {
      const body = chunks[ci];
      const part = chunks.length > 1 ? `${ci + 1}/${chunks.length}` : null;
      // 다시 읽어 빌드하는 루프 — hashes 선행조건(결정 7 의 3단계). 데모는 단일 프로세스라
      // 두 번째 바퀴가 돌 일이 없지만, 앱 편집기가 들어오면 여기서 잡는다.
      for (let attempt = 0; ; attempt++) {
        const wiki = await loadWiki(args.vault);
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
        if (ci === 0 && prev && prev.hash !== item.hash) {
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

        // 후보 추리기 — 글자 일치는 항상, 뜻 유사도는 --embed 일 때만.
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

        const note = {
          path: item.key,
          name: item.name,
          body,
          userFm: {},
          hash: item.hash,
          date: item.date,
        };
        const cands = pickCandidates(note, [...wiki.values()], embedOpts);
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

        const userMessage = buildUserMessage(note, cands, part);

        if (args.dry) {
          console.log("\n" + "─".repeat(70));
          console.log(userMessage);
          console.log("─".repeat(70) + "\n");
          break;
        }

        // 같은 입력이면 캐시에서 온다 — 선행조건 재시도가 AI 를 다시 부르지 않는 이유.
        const res = await writeWiki(systemPrompt, userMessage, {
          noCache: args.noCache && attempt === 0,
        });
        if (attempt === 0) {
          if (res.cached) cached++;
          else calls++;
          console.log(
            `   AI ${res.cached ? "(캐시)" : "호출"} (입력 ${userMessage.length}자) → 페이지 ${res.pages.length}장`,
          );
        }

        const verified = verify({
          llmPages: res.pages,
          sourceBody: body,
          names: nameIndex(wiki.values()),
          existing: wiki,
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
            path: wikiPath(args.vault, page.name),
            content: md,
            mustExist: !!existing,
          });
          logs.push(
            `   ${existing ? "갱신" : "생성"} wiki/${safeFileName(page.name)}.md (기록 ${page.records.length}, 링크 ${countBodyLinks(md)})`,
          );
          stale.delete(normalizeTitle(page.name));
        }
        // 기록을 걷어냈는데 이번 결과에 없는 페이지 — 걷어낸 상태 그대로 써서 남긴다.
        for (const key of stale) {
          const existing = wiki.get(key)!;
          writes.push({
            path: wikiPath(args.vault, existing.name),
            content: rebuildRecordsOnly(existing, today),
            mustExist: true,
          });
          logs.push(`   정리 wiki/${safeFileName(existing.name)}.md (이 노트의 옛 기록을 뺌)`);
        }

        // 선행조건 — 쓰기 직전에 대상 페이지를 다시 읽어 hashes 가 그대로인지 본다.
        // 다르면 누군가(앱 편집기) 그 사이에 고친 것이다. 새 판 위에 빌더를 다시 돌린다.
        let changed = false;
        const wikiDir = join(args.vault, "wiki");
        for (const w of writes) {
          if (!w.mustExist || !w.path.startsWith(wikiDir)) continue;
          const rel =
            "wiki/" +
            w.path
              .slice(wikiDir.length + 1)
              .split("\\")
              .join("/");
          const fresh = await readWikiPage(args.vault, rel).catch(() => null);
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

        await commitFiles(writes);
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

    if (!args.dry) {
      state.notes[item.key] = { hash: item.hash, compiledAt: new Date().toISOString() };
      // 항목마다 저장한다. 끝에서 한 번만 쓰면 중간에 죽었을 때 위키는 바뀌었는데
      // 상태는 안 남아, 다음 실행이 같은 노트를 다시 정리해 기록이 두 번 쌓인다.
      await writeSyncState(args.vault, state);
    }
    console.log("");
  }

  // 요약 — 링크 밀도는 사업계획서의 기준선 1.5 와 비교한다.
  const finalWiki = await loadWiki(args.vault);
  let links = 0;
  for (const p of await scanWiki(args.vault)) {
    links += countBodyLinks(await readFile(join(args.vault, p), "utf8"));
  }
  const density = finalWiki.size ? (links / finalWiki.size).toFixed(2) : "0";

  console.log("═".repeat(70));
  console.log(`위키 ${finalWiki.size}장 · 링크 ${links}개 · 문서당 ${density} (기준선 1.5)`);
  console.log(
    `AI 호출 ${calls}회 · 캐시 ${cached}회 · 임베딩 ${embedStats.sent}항목 · 지적 ${allIssues.length}건`,
  );
  if (finalWiki.size) {
    console.log(`\n만들어진 페이지: ${[...finalWiki.values()].map((p) => p.name).join(", ")}`);
  }
}

main().catch((e: unknown) => {
  console.error("\n실패:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
