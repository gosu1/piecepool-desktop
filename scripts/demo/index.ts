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
  normalizeTitle,
  readNote,
  readWikiPage,
  scanNotes,
  scanWiki,
  type WikiPage,
} from "./vault.ts";
import { buildUserMessage, pageEmbedText, pickCandidates } from "./prompt.ts";
import { MODELS, embed, writeWiki } from "./llm.ts";
import { buildMarkdown, looksEmpty, safeFileName, verify } from "./build.ts";

type Args = {
  vault: string;
  dry: boolean;
  useEmbed: boolean;
  only: string | null;
  noCache: boolean;
  threshold: number;
  topN: number;
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
  const today = new Date().toISOString().slice(0, 10);

  console.log(`볼트: ${args.vault}`);
  console.log(
    `모델: ${args.dry ? "(호출 없음)" : MODELS.chat}${args.useEmbed ? ` + ${MODELS.embed}` : ""}`,
  );
  console.log("");

  const systemPrompt = await readFile("src/core/prompts/write.md", "utf8");
  const state = await readSyncState(args.vault);

  let notePaths = await scanNotes(args.vault);
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

    const wiki = await loadWiki(args.vault);

    // 후보 추리기 — 글자 일치는 항상, 뜻 유사도는 --embed 일 때만.
    let embedOpts;
    if (args.useEmbed && wiki.size > 0) {
      const pages = [...wiki.values()];
      const vecs = await embed([note.body, ...pages.map(pageEmbedText)]);
      embedOpts = {
        noteVec: vecs[0],
        pageVecs: new Map(pages.map((p, i) => [p.name, vecs[i + 1]])),
        threshold: args.threshold,
        topN: args.topN,
      };
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
    console.log(`   AI ${res.cached ? "(캐시)" : "호출"} → 페이지 ${res.pages.length}장`);

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
      const md = buildMarkdown({
        page,
        existing,
        sourceName: note.name,
        date: note.date,
        today,
      });

      // 출력 벽 1 — 빈 깡통이면 기존 위키를 지킨다.
      if (looksEmpty(md)) {
        console.log(`   ! 빈-깡통 [${page.name}] 저장을 취소했습니다`);
        allIssues.push(`${path} 빈-깡통 [${page.name}]`);
        continue;
      }

      const file = join(args.vault, "wiki", `${safeFileName(page.name)}.md`);
      await mkdir(join(args.vault, "wiki"), { recursive: true });
      await writeFile(file, md, "utf8");
      const mark = existing ? "갱신" : "생성";
      console.log(
        `   ${mark} wiki/${safeFileName(page.name)}.md (기록 ${page.records.length}, 링크 ${countBodyLinks(md)})`,
      );
    }

    state.notes[path] = { hash: note.hash, compiledAt: new Date().toISOString() };
    console.log("");
  }

  if (!args.dry) {
    await writeSyncState(args.vault, state);
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
  console.log(`AI 호출 ${calls}회 · 캐시 ${cached}회 · 지적 ${allIssues.length}건`);
  if (finalWiki.size) {
    console.log(`\n만들어진 페이지: ${[...finalWiki.values()].map((p) => p.name).join(", ")}`);
  }
}

main().catch((e: unknown) => {
  console.error("\n실패:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
