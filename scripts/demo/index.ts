// 데모 — 파이프라인을 끝까지 관통한다. ADR-0002 가 실제로 작동하는지 보기 위한 것이다.
//
//   node --env-file=.env scripts/demo/index.ts --dry
//   node --env-file=.env scripts/demo/index.ts --only "DETR"
//   node --env-file=.env scripts/demo/index.ts --embed
//
// 제품 코드가 아니다. 설계가 검증되면 src/core/ 로 옮긴다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
import { buildMarkdown, hasChanges, safeFileName, verify } from "./build.ts";

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
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    vault: "fixtures/vault",
    dry: false,
    useEmbed: false,
    only: null,
    noCache: false,
    threshold: 0.6,
    topN: 8,
    prompt: "src/core/prompts/write.md",
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
  }
  return a;
}

type SyncState = { notes: Record<string, { hash: string; compiledAt: string }> };

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

/**
 * `나.md` 가 없으면 만든다. '나' 에 관한 페이지들의 목차이고, 레퍼런스의
 * overview.md / Home.md 와 같은 고정 허브다. 내용은 AI 가 채우고, 여기서는
 * 존재만 보장한다. 요약은 AI 가 큰 그림이 바뀔 때만 고친다.
 */
async function ensureMePage(vault: string, today: string): Promise<void> {
  const file = join(vault, "wiki", "나.md");
  try {
    await readFile(file, "utf8");
    return;
  } catch {
    // 없다 — 만든다
  }
  await mkdir(join(vault, "wiki"), { recursive: true });
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
  await writeFile(file, md, "utf8");
  console.log("   wiki/나.md 를 만들었습니다 (허브)");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadWiki(vault: string): Promise<Map<string, WikiPage>> {
  const map = new Map<string, WikiPage>();
  for (const p of await scanWiki(vault)) {
    const page = await readWikiPage(vault, p);
    map.set(normalizeTitle(page.name), page);
  }
  return map;
}

/** 볼트에 실재하는 이름 전부 — 제목과 별칭. 링크 검증의 허용 목록. */
function knownNames(wiki: Map<string, WikiPage>): Set<string> {
  const s = new Set<string>();
  for (const page of wiki.values()) {
    s.add(normalizeTitle(page.name));
    for (const a of page.fm.aliases ?? []) s.add(normalizeTitle(a));
  }
  return s;
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

  // 날짜순으로 처리한다. 경로순이면 `독서/` 가 `일기/` 보다 먼저 와서 시간이 뒤섞이고,
  // 뒤에 만들어질 페이지의 사실이 앞 노트에서 빠진다.
  const dated = await Promise.all(
    (await scanNotes(args.vault)).map(async (p) => ({
      p,
      d: (await readNote(args.vault, p)).date ?? "9999",
    })),
  );
  let notePaths = dated
    .sort((a, b) => a.d.localeCompare(b.d) || a.p.localeCompare(b.p))
    .map((x) => x.p);
  if (args.only) {
    const q = normalizeTitle(args.only);
    notePaths = notePaths.filter((p) => normalizeTitle(p).includes(q));
  }
  if (notePaths.length === 0) {
    console.log("처리할 노트가 없습니다.");
    return;
  }

  let calls = 0;
  let cached = 0;
  let embedOk = args.useEmbed;
  const allIssues: string[] = [];

  for (const path of notePaths) {
    const note = await readNote(args.vault, path);
    console.log(`── ${path}`);
    console.log(`   날짜 ${note.date ?? "(미상)"} · 본문 ${note.body.length}자`);

    // 입력 벽 7 — 이미 처리했고 내용이 그대로면 건너뛴다.
    const prev = state.notes[path];
    if (prev && prev.hash === note.hash && !args.noCache) {
      console.log("   이미 처리했습니다 (해시 동일) — 건너뜁니다\n");
      continue;
    }

    await ensureMePage(args.vault, today);
    const wiki = await loadWiki(args.vault);

    // 노트가 바뀌어 다시 정리하는 경우 — 이 노트에서 나온 기록을 먼저 걷어낸다.
    // 덧붙이기만 하면 같은 사실이 표현만 다른 줄로 두 번 쌓인다 (4회차 실측:
    // "트레이너가 … 했다" 와 "… 트레이너가 말했다"). 기록은 출처에서 파생된 것이므로
    // 출처가 바뀌면 다시 파생한다. 출처가 **삭제된** 경우와는 다르다 — 그때는 표시만 남긴다.
    // 사용자가 기록 절을 고친 페이지는 건드리지 않는다.
    const stale = new Set<string>();
    if (prev && prev.hash !== note.hash) {
      const tag = new RegExp(`← \\[\\[${escapeRe(note.name)}(\\]\\]|#)`);
      for (const page of wiki.values()) {
        if (!page.recordsOurs) continue;
        const kept = page.records.filter((r) => !tag.test(r));
        if (kept.length !== page.records.length) {
          page.records = kept;
          stale.add(normalizeTitle(page.name));
        }
      }
      if (stale.size) console.log(`   다시 정리 — 기록을 걷어낸 페이지 ${stale.size}장`);
    }

    // 후보 추리기 — 글자 일치는 항상, 뜻 유사도는 --embed 일 때만.
    // 임베딩이 막히면(한도 소진 등) 글자 일치만으로 계속 간다. 후보를 넓히는 보조
    // 수단 때문에 정리 자체가 멈추면 안 된다.
    let embedOpts;
    if (embedOk && wiki.size > 0) {
      try {
        const pages = [...wiki.values()];
        const vecs = await embed([note.body, ...pages.map(pageEmbedText)]);
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
        allIssues.push(`${path} 임베딩-불가`);
      }
    }

    const cands = pickCandidates(note, [...wiki.values()], embedOpts);
    if (cands.related.length) {
      const detail = cands.related.map((p) => `${p.name}(${cands.why.get(p.name)})`).join(", ");
      console.log(`   후보 ${cands.related.length}장: ${detail}`);
    } else {
      console.log(`   후보 없음 (위키 ${wiki.size}장)`);
    }

    const userMessage = buildUserMessage(note, cands);

    if (args.dry) {
      console.log("\n" + "─".repeat(70));
      console.log(userMessage);
      console.log("─".repeat(70) + "\n");
      continue;
    }

    const res = await writeWiki(systemPrompt, userMessage, { noCache: args.noCache });
    if (res.cached) cached++;
    else calls++;
    console.log(
      `   AI ${res.cached ? "(캐시)" : "호출"} (입력 ${userMessage.length}자) → 페이지 ${res.pages.length}장`,
    );

    const verified = verify({
      llmPages: res.pages,
      sourceBody: note.body,
      knownNames: knownNames(wiki),
      existing: wiki,
    });

    for (const i of verified.issues) {
      const line = `   ! ${i.kind} [${i.page}] ${i.detail}`;
      console.log(line);
      allIssues.push(`${path} ${i.kind} [${i.page}] ${i.detail}`);
    }

    for (const page of verified.pages) {
      const existing = wiki.get(normalizeTitle(page.name));

      if (!hasChanges(page)) {
        if (!existing) {
          // 출력 벽 1 — 검문 뒤 아무것도 안 남은 새 페이지는 만들지 않는다.
          console.log(`   ! 빈-깡통 [${page.name}] 만들지 않았습니다`);
          allIssues.push(`${path} 빈-깡통 [${page.name}]`);
        } else {
          console.log(`   변화 없음 [${page.name}] 쓰지 않았습니다`);
        }
        continue;
      }

      const md = buildMarkdown({
        page,
        existing,
        sourceName: note.name,
        date: note.date,
        today,
      });

      const file = join(args.vault, "wiki", `${safeFileName(page.name)}.md`);
      await mkdir(join(args.vault, "wiki"), { recursive: true });
      await writeFile(file, md, "utf8");
      const mark = existing ? "갱신" : "생성";
      console.log(
        `   ${mark} wiki/${safeFileName(page.name)}.md (기록 ${page.records.length}, 링크 ${countBodyLinks(md)})`,
      );
      stale.delete(normalizeTitle(page.name));
    }

    // 기록을 걷어냈는데 이번 결과에 없는 페이지 — 걷어낸 상태 그대로 써서 남긴다.
    for (const key of stale) {
      const existing = wiki.get(key)!;
      const md = buildMarkdown({
        page: {
          name: existing.name,
          aliasesToAdd: [],
          summary: null,
          newSections: [],
          replaces: [],
          records: [],
        },
        existing,
        sourceName: note.name,
        date: note.date,
        today,
      });
      await writeFile(join(args.vault, "wiki", `${safeFileName(existing.name)}.md`), md, "utf8");
      console.log(`   정리 wiki/${safeFileName(existing.name)}.md (이 노트의 옛 기록을 뺌)`);
    }

    state.notes[path] = { hash: note.hash, compiledAt: new Date().toISOString() };
    // 노트마다 저장한다. 끝에서 한 번만 쓰면 중간에 죽었을 때 위키는 바뀌었는데
    // 상태는 안 남아, 다음 실행이 같은 노트를 다시 정리해 기록이 두 번 쌓인다.
    await writeSyncState(args.vault, state);
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
