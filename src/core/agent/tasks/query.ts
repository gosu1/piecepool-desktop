// FROZEN: ask() 진입점만 동결. QuerySession 은 가배치 (0단계 설계 §8)
// OWNER: B — 6단계에서 쿼리(B)가 채웠다 (2026-09-18).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OnProgress, Vault } from "../../../shared/types.ts";
import type { LlmMessage } from "../../llm/chat.ts";
import { loadPrompt } from "../../prompts/load.ts";
import { scanVault, titleOf, type VaultIndex } from "../../index/scan.ts";
import { runAgent, type AgentResult } from "../loop.ts";
import { createTools, type Tool } from "../tools.ts";
import { Written } from "../written.ts";

/** 세션 로그의 계기. 본문이 아니라 프론트매터에 간다. */
export interface SessionMeta {
  id: string;
  model: string;
  /** 세션을 시작한 날 (로컬). ingest 가 출처 날짜로 읽는다 — `itemFromSource` 의 `date:` 정규식. */
  date: string;
  turns: number;
  toolCalls: number;
  hitCap: boolean;
  tokens: { in: number; cached: number; out: number };
  usd: number | null;
  opened: string[];
}

/**
 * `ask()` 를 거듭 부르면 쌓이는 계기. 프론트매터는 이것을 쓴다 —
 * 마지막 호출분만 쓰면 5턴 대화의 `usd` 가 한 턴 비용이 되고,
 * `opened` 에서 앞 턴들이 연 절이 빠져 수확이 그 근거를 잃는다 (설계 §11.2).
 */
export interface SessionStats {
  turns: number;
  toolCalls: number;
  hitCap: boolean;
  tokens: { in: number; cached: number; out: number };
  usd: number | null;
  opened: Set<string>;
}

export function accumulate(prev: SessionStats | undefined, res: AgentResult): SessionStats {
  const sum = (pick: (u: AgentResult["usage"][number]) => number) =>
    res.usage.reduce((a, u) => a + pick(u), 0);
  const usd = res.usage.every((u) => u.usd === null) ? null : sum((u) => u.usd ?? 0);
  return {
    turns: (prev?.turns ?? 0) + res.turns,
    toolCalls: (prev?.toolCalls ?? 0) + res.toolCalls,
    hitCap: (prev?.hitCap ?? false) || res.hitCap,
    tokens: {
      in: (prev?.tokens.in ?? 0) + sum((u) => u.prompt),
      cached: (prev?.tokens.cached ?? 0) + sum((u) => u.cached),
      out: (prev?.tokens.out ?? 0) + sum((u) => u.completion),
    },
    usd: prev?.usd == null && usd === null ? null : (prev?.usd ?? 0) + (usd ?? 0),
    opened: new Set([...(prev?.opened ?? []), ...res.opened]),
  };
}

export interface Turn {
  who: "사용자" | "AI";
  text: string;
}

export interface QuerySession {
  id: string;
  /** 세션을 시작한 날 `YYYY-MM-DD` (로컬). 만드는 쪽이 한 번 정한다 — 매 턴 다시 찍으면 자정을 넘긴 대화의 날짜가 바뀐다. */
  date: string;
  log: string;
  /** 지금까지의 턴. 로그를 다시 쓸 때 쓴다. */
  turns: Turn[];
  /** LLM 에게 넘길 대화. 대명사는 이것으로 풀린다. */
  history: LlmMessage[];
  /**
   * 세션이 쓰는 툴. **한 번 만들어 계속 쓴다** — 툴 안에 절 색인이 캐시돼 있어
   * 매 턴 새로 만들면 위키 전체를 다시 읽는다 (설계 §5.6).
   */
  tools?: Tool[];
  /**
   * backlinks 툴용 링크 색인. **한 번 만들어 계속 쓴다** — `scanVault` 는 볼트의
   * 모든 마크다운 파일을 읽어 툴 캐시보다 비싼데, 대화 중에는 위키가 바뀌지
   * 않는다(읽기 전용, 수확은 B3) — 설계 §5.6.
   */
  index?: VaultIndex;
  /** 누계 계기. `ask()` 가 채운다. */
  stats?: SessionStats;
}

/**
 * 세션 로그를 만든다. 본문 형식은 B 가 고르는 것이 아니라
 * A 의 `ingest/source.ts` · `prompts/write.md` · `ingest/tx.test.ts` 가 전제한다.
 * 다르게 쓰면 수확이 조용히 깨진다.
 */
export function buildSessionLog(meta: SessionMeta, turns: Turn[]): string {
  const out: string[] = ["---"];
  out.push(`id: ${meta.id}`);
  out.push(`model: ${meta.model}`);
  out.push(`date: ${meta.date}`);
  out.push(`turns: ${meta.turns}`);
  out.push(`tool_calls: ${meta.toolCalls}`);
  out.push(`hit_cap: ${meta.hitCap}`);
  out.push(
    `tokens: { in: ${meta.tokens.in}, cached: ${meta.tokens.cached}, out: ${meta.tokens.out} }`,
  );
  if (meta.usd !== null) out.push(`usd: ${meta.usd.toFixed(4)}`);
  if (meta.opened.length) {
    out.push("opened:");
    for (const p of meta.opened) out.push(`  - ${p}`);
  }
  out.push("---", "");
  turns.forEach((t, i) => {
    out.push(`## ${i + 1}턴 (${t.who})`, "", t.text, "");
  });
  return out.join("\n");
}

/**
 * 이번 턴이 연 것을 화면의 참고 줄로 바꾼다 — `#절` 을 떼고 페이지 이름으로 합쳐 정렬.
 * 답변 텍스트에 붙이지 않는다. 로그에는 프론트매터 `opened:` 가 이미 있고,
 * AI 턴 본문에 `[[페이지]]` 가 섞이면 수확의 ingest 가 내용으로 읽는다 (B4 설계 §2).
 */
export function openedPages(opened: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const o of opened) names.add(titleOf(o.split("#")[0]));
  return [...names].sort();
}

/** 위키를 근거로 답한다. 읽기 전용 툴만 받는다 — 대화 중에는 위키를 고치지 않는다. */
export async function ask(
  v: Vault,
  session: QuerySession,
  question: string,
  o?: { onProgress?: OnProgress },
): Promise<string> {
  const prompt = await loadPrompt("query");
  // 색인도 툴도 세션에 한 번만 만든다 — 대화 중에는 위키가 바뀌지 않는다 (설계 §5.6).
  const index = (session.index ??= await scanVault(v));
  session.tools ??= createTools(v, new Written(), { readOnly: true, index });

  const res = await runAgent(prompt, question, session.tools, {
    onProgress: o?.onProgress,
    history: session.history,
  });

  session.turns.push({ who: "사용자", text: question });
  session.turns.push({ who: "AI", text: res.text });
  session.history.push({ role: "user", text: question });
  session.history.push({ role: "model", text: res.text });

  session.stats = accumulate(session.stats, res);
  const md = buildSessionLog(
    {
      id: session.id,
      model: process.env.PIECEPOOL_LLM_MODEL ?? "kimi-k3",
      date: session.date,
      ...session.stats,
      opened: [...session.stats.opened].sort(),
    },
    session.turns,
  );
  session.log = md;

  const dir = join(v.root, ".piecepool", "sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${session.id}.md`), md, "utf8");

  const pages = openedPages(res.opened);
  if (pages.length) {
    o?.onProgress?.({ step: "참고", detail: pages.map((p) => `[[${p}]]`).join(" · ") });
  }
  return res.text;
}
