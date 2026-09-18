// FROZEN: ask() 진입점만 동결. QuerySession 은 가배치 (0단계 설계 §8)
// OWNER: B — 6단계에서 쿼리(B)가 채웠다 (2026-09-18).
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OnProgress, Vault } from "../../../shared/types.ts";
import type { LlmMessage } from "../../llm/chat.ts";
import { loadPrompt } from "../../prompts/load.ts";
import { resolveLink } from "../../index/links.ts";
import { scanVault, type VaultIndex } from "../../index/scan.ts";
import { checkCitations } from "../cite.ts";
import { runAgent } from "../loop.ts";
import { createTools, type Tool } from "../tools.ts";
import { Written } from "../written.ts";

/** 세션 로그의 계기. 본문이 아니라 프론트매터에 간다. */
export interface SessionMeta {
  id: string;
  model: string;
  turns: number;
  toolCalls: number;
  hitCap: boolean;
  tokens: { in: number; cached: number; out: number };
  usd: number | null;
  opened: string[];
  unsourced: number;
}

export interface Turn {
  who: "사용자" | "AI";
  text: string;
}

export interface QuerySession {
  id: string;
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
   * 근거 대조용 링크 색인. **한 번 만들어 계속 쓴다** — `scanVault` 는 볼트의
   * 모든 마크다운 파일을 읽어 툴 캐시보다 비싼데, 대화 중에는 위키가 바뀌지
   * 않는다(읽기 전용, 수확은 B3) — 설계 §5.6.
   */
  index?: VaultIndex;
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
  out.push(`unsourced: ${meta.unsourced}`);
  out.push("---", "");
  turns.forEach((t, i) => {
    out.push(`## ${i + 1}턴 (${t.who})`, "", t.text, "");
  });
  return out.join("\n");
}

/** 위키를 근거로 답한다. 읽기 전용 툴만 받는다 — 대화 중에는 위키를 고치지 않는다. */
export async function ask(
  v: Vault,
  session: QuerySession,
  question: string,
  o?: { onProgress?: OnProgress },
): Promise<string> {
  const prompt = await loadPrompt("query");
  // 툴은 세션에 한 번만 만든다 — 툴 안에 절 색인이 캐시돼 있어
  // 매 턴 새로 만들면 위키 전체를 다시 읽는다 (설계 §5.6).
  session.tools ??= createTools(v, new Written(), { readOnly: true });

  const res = await runAgent(prompt, question, session.tools, {
    onProgress: o?.onProgress,
    history: session.history,
  });

  // 근거 대조 — 연 적 없는 절을 가리킨 링크를 뗀다.
  // 링크 색인도 세션에 한 번만 만든다 — 대화 중에는 위키가 바뀌지 않는다 (설계 §5.6).
  session.index ??= await scanVault(v);
  const cited = checkCitations(res.text, res.opened, (name) =>
    resolveLink("", name, session.index!.targets),
  );

  session.turns.push({ who: "사용자", text: question });
  session.turns.push({ who: "AI", text: cited.text });
  session.history.push({ role: "user", text: question });
  session.history.push({ role: "model", text: cited.text });

  const sum = (pick: (u: (typeof res.usage)[number]) => number) =>
    res.usage.reduce((a, u) => a + pick(u), 0);
  const usd = res.usage.every((u) => u.usd === null) ? null : sum((u) => u.usd ?? 0);

  const md = buildSessionLog(
    {
      id: session.id,
      model: process.env.PIECEPOOL_LLM_MODEL ?? "kimi-k3",
      turns: res.turns,
      toolCalls: res.toolCalls,
      hitCap: res.hitCap,
      tokens: {
        in: sum((u) => u.prompt),
        cached: sum((u) => u.cached),
        out: sum((u) => u.completion),
      },
      usd,
      opened: [...res.opened].sort(),
      unsourced: cited.unsourced,
    },
    session.turns,
  );
  session.log = md;

  const dir = join(v.root, ".piecepool", "sessions");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${session.id}.md`), md, "utf8");

  if (cited.dropped.length) {
    o?.onProgress?.({
      step: "근거 없음",
      detail: `연 적 없는 절 ${cited.dropped.length}건의 링크를 뗐다`,
    });
  }
  return cited.text;
}
