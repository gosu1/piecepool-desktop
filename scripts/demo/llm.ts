// Gemini 호출 — OpenAI 호환 엔드포인트를 fetch 로 직접 쓴다. 패키지를 늘리지 않는다.
//
// 응답을 파일로 캐시한다. 무료 티어의 하루 요청 한도(RPD)가 작아서,
// 프롬프트를 바꾸지 않고 빌더만 고칠 때 다시 부르면 금세 소진된다.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ENDPOINT =
  process.env.PIECEPOOL_LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai";

// piecepool2 의 실측 주석에 따르면 gemini-3.5-flash 는 무료 티어 RPD 가 20회다.
// 개발 중에는 lite 를 쓴다. 운영 모델은 한국어 eval 뒤에 정한다 (ADR 미결).
const CHAT_MODEL = process.env.PIECEPOOL_LLM_MODEL ?? "gemini-3.1-flash-lite";
const EMBED_MODEL = process.env.PIECEPOOL_EMBED_MODEL ?? "gemini-embedding-001";

// Kimi 는 temperature 등을 고정값으로 요구한다("omit them from requests"). 추론 깊이만 고른다 —
// 기본 max 는 출력($15/1M)이 가장 많이 나온다. 실비이므로 낮은 것부터 잰다.
// k2.6 은 reasoning_effort 를 모른다 — 보내면 조용히 받고 8.6k 토큰을 생각한 뒤 답을 거의 안 냈다
// (2026-09-16 실측). k2.6 은 `thinking` 스위치로 끄고, 문서가 권하는 기본 온도를 쓴다.
const IS_KIMI = CHAT_MODEL.startsWith("kimi");
const SAMPLING =
  CHAT_MODEL === "kimi-k3"
    ? { reasoning_effort: process.env.PIECEPOOL_REASONING_EFFORT ?? "low" }
    : IS_KIMI
      ? { thinking: { type: "disabled" } }
      : { temperature: 0.2 };

/** 1M 토큰당 달러 — 입력(캐시 안 됨) · 입력(캐시 됨) · 출력. 없는 모델은 토큰만 센다. */
const PRICES: Record<string, { in: number; hit: number; out: number }> = {
  "kimi-k3": { in: 3, hit: 0.3, out: 15 },
  "kimi-k2.6": { in: 0.95, hit: 0.16, out: 4 },
};

/** 이번 실행의 토큰과 비용. 실비가 나가는 모델은 호출마다 로그에 찍는다. */
export const usage = {
  calls: 0,
  prompt: 0,
  cached: 0,
  completion: 0,
  reasoning: 0,
  usd: 0,
  /** 호출마다 걸린 ms. 중앙값을 내려고 모은다. */
  elapsed: [] as number[],
  /** 이 달러를 넘으면 다음 호출 전에 멈춘다. 0 이면 상한 없음. */
  limitUsd: 0,
  last: "",
};

/** 예산 상한에 걸렸다. 호출부가 잡아서 항목 루프를 끝낸다 — 재시도할 일이 아니다. */
export class BudgetExceeded extends Error {}

function checkBudget(): void {
  if (usage.limitUsd > 0 && usage.usd >= usage.limitUsd) {
    throw new BudgetExceeded(
      `예산 상한 $${usage.limitUsd} 도달 (누적 $${usage.usd.toFixed(3)}) — 호출하지 않고 멈춥니다`,
    );
  }
}

type Usage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

function recordUsage(raw: { usage?: Usage }, ms: number): void {
  usage.elapsed.push(ms);
  const u = raw.usage;
  if (!u) return;
  const prompt = u.prompt_tokens ?? 0;
  const completion = u.completion_tokens ?? 0;
  const cached = u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? 0;
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
  const p = PRICES[CHAT_MODEL];
  const usd = p ? ((prompt - cached) * p.in + cached * p.hit + completion * p.out) / 1e6 : 0;
  usage.calls++;
  usage.prompt += prompt;
  usage.cached += cached;
  usage.completion += completion;
  usage.reasoning += reasoning;
  usage.usd += usd;
  usage.last = `토큰 입력 ${prompt} (캐시 ${cached}) · 출력 ${completion} (추론 ${reasoning})${p ? ` · $${usd.toFixed(4)}` : ""} · ${(ms / 1000).toFixed(1)}s`;
}

export function usageSummary(): string {
  const p = PRICES[CHAT_MODEL];
  const sorted = [...usage.elapsed].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const total = usage.elapsed.reduce((a, b) => a + b, 0);
  return `토큰 입력 ${usage.prompt} (캐시 ${usage.cached}) · 출력 ${usage.completion} (추론 ${usage.reasoning}) · ${p ? `$${usage.usd.toFixed(2)}` : "요금표 없음"} · 호출 중앙값 ${(median / 1000).toFixed(1)}s 합계 ${Math.round(total / 1000)}s`;
}

/** 실행 설정을 로그 머리에 남기려고 밖에 보인다. */
export const SETTINGS = { model: CHAT_MODEL, sampling: SAMPLING };

function apiKey(): string {
  const k = process.env.PIECEPOOL_LLM_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!k) {
    throw new Error(
      "GEMINI_API_KEY 가 없습니다. .env 에 넣고 `node --env-file=.env` 로 실행하십시오.",
    );
  }
  return k;
}

/** JSON Schema — Structured Outputs 로 형식을 강제한다. ADR-0002 결정 2 의 스키마. */
const PAGES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pages"],
  properties: {
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "aliases_to_add",
          "summary",
          "new_sections",
          "replace_sections",
          "new_records",
        ],
        properties: {
          name: { type: "string" },
          aliases_to_add: { type: "array", items: { type: "string" } },
          summary: { type: ["string", "null"] },
          new_sections: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["heading", "content"],
              properties: { heading: { type: "string" }, content: { type: "string" } },
            },
          },
          // 기존 절은 통째로 다시 쓴다. hashes 가 일치하는 절(우리 글)만 — 검문이 확인한다.
          // append 를 두면 AI 는 그것만 쓴다 (2회차: append 312 대 replace 2). 그러면
          // "몰랐다" 와 "알았다" 가 한 절에 날짜 없이 쌓이고, `민지 / 특징` 이 18문단이 된다.
          // 다시 쓰게 하면 새 사실이 기존 문장에 녹고, 시간순은 기록 절이 보존한다.
          replace_sections: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["target_heading", "content"],
              properties: { target_heading: { type: "string" }, content: { type: "string" } },
            },
          },
          new_records: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fact", "quote"],
              properties: { fact: { type: "string" }, quote: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

export type LlmPage = {
  name: string;
  aliases_to_add: string[];
  summary: string | null;
  new_sections: { heading: string; content: string }[];
  replace_sections: { target_heading: string; content: string }[];
  new_records: { fact: string; quote: string }[];
};

const CACHE_DIR = ".piecepool/demo-cache";

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(CACHE_DIR, `${key}.json`), "utf8")) as T;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, value: unknown): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2), "utf8");
}

function keyOf(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0"), "utf8").digest("hex").slice(0, 16);
}

/**
 * 429·5xx 만 재시도한다. 400·401 은 다시 불러도 같은 답이다.
 *
 * 시간 초과는 다르다 — 클라이언트가 끊어도 서버는 생성을 마치고 과금할 수 있다. 무료 모델은
 * 열 번 재시도해도 잃는 게 없지만 실비 모델은 이중 과금이다. Kimi 는 추론이 길어 600초까지
 * 기다리고, 그래도 넘으면 한 번만 다시 부른다.
 */
async function postJson(path: string, body: unknown): Promise<unknown> {
  const url = `${ENDPOINT}${path}`;
  const timeoutMs = IS_KIMI ? 600_000 : 120_000;
  const maxNetRetries = IS_KIMI ? 1 : 10;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: unknown) {
      // 시간 초과와 네트워크 오류도 잠시 뒤에는 풀린다. 응답이 느려진 날 60초에서 죽었다.
      if (attempt >= maxNetRetries) throw e;
      const wait = Math.min(2000 * 2 ** attempt, 120_000);
      console.warn(
        `  ! ${e instanceof Error ? e.name : "fetch"} — ${wait / 1000}s 뒤 재시도${IS_KIMI ? " (이중 과금 가능)" : ""}`,
      );
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.ok) return res.json();
    const text = await res.text();
    const retriable = res.status === 429 || res.status >= 500;
    // 하루 한도(RPD)는 기다려도 안 풀린다. 바로 멈춰서 다음 날 이어받게 한다.
    // 분 한도 메시지에도 "daily" 가 섞여 있을 수 있어 quota id 의 PerDay 만 본다.
    const daily = res.status === 429 && /PerDay/.test(text);
    if (!retriable || daily || attempt >= 10) {
      throw new Error(
        `${res.status} ${res.statusText} — ${text.replace(/\s+/g, " ").slice(0, 1500)}`,
      );
    }
    // 분 한도(RPM)와 503(수요 폭증)은 지나가면 풀린다. 2초부터 두 배씩, 최대 120초.
    // 503 이 2분 넘게 이어진 적이 있다 (2026-09-15 새벽).
    const wait = Math.min(2000 * 2 ** attempt, 120_000);
    console.warn(`  ! ${res.status} — ${wait / 1000}s 뒤 재시도 (${attempt + 1}/10)`);
    await new Promise((r) => setTimeout(r, wait));
  }
}

/** k2.6 은 strict 스키마에도 가끔 ```json 울타리를 두른다 (문서가 "벗기고 파싱하라" 고 한다). */
function unfence(content: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(content);
  return m ? m[1] : content;
}

/** 위키 작성 호출. 캐시가 있으면 부르지 않는다. */
export async function writeWiki(
  systemPrompt: string,
  userMessage: string,
  opts: { noCache?: boolean } = {},
): Promise<{ pages: LlmPage[]; cached: boolean }> {
  // 샘플링 설정도 키에 든다 — effort 가 빠지면 high 회차가 low 의 캐시를 재생해 "차이 없음" 이 된다.
  const key = keyOf("chat", CHAT_MODEL, JSON.stringify(SAMPLING), systemPrompt, userMessage);
  if (!opts.noCache) {
    const hit = await cacheGet<{ pages: LlmPage[] }>(key);
    if (hit) return { pages: hit.pages, cached: true };
  }

  checkBudget();
  const t0 = Date.now();
  const raw = (await postJson("/chat/completions", {
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "wiki_pages", strict: true, schema: PAGES_SCHEMA },
    },
    // 폭주 벽. 추론 토큰까지 세므로 넉넉히 — 정상 출력은 2k 안팎이다.
    max_tokens: 32_000,
    ...SAMPLING,
  })) as { choices?: { message?: { content?: string } }[]; usage?: Usage };
  recordUsage(raw, Date.now() - t0);

  const content = raw.choices?.[0]?.message?.content;
  if (!content) throw new Error(`빈 응답: ${JSON.stringify(raw).slice(0, 300)}`);

  const parsed = JSON.parse(unfence(content)) as { pages: LlmPage[] };
  await cacheSet(key, parsed);
  return { pages: parsed.pages, cached: false };
}

/** 이번 실행에서 임베딩 엔드포인트로 실제 보낸 항목 수. 한도 관리용. */
export const embedStats = { sent: 0 };

/**
 * 임베딩. **문장마다 따로 캐시**하고 없는 것만 한 번에 보낸다.
 *
 * 묶음 전체를 한 키로 캐시하면 페이지가 하나만 새로 생겨도 전부 다시 재고,
 * 무료 티어는 묶음 안의 항목 하나하나를 요청으로 센다 — 62장 볼트에서 43장 만에
 * 하루 한도 1000회를 다 썼다 (2026-09-15 실측). 페이지의 제목·요약이 안 바뀌면
 * 벡터도 안 바뀌므로, 노트당 호출은 1 + (요약이 바뀐 페이지 수) 로 충분하다.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const out: (number[] | null)[] = await Promise.all(
    texts.map((t) => cacheGet<number[]>(keyOf("embed1", EMBED_MODEL, t))),
  );
  const missing = texts.map((t, i) => ({ t, i })).filter(({ i }) => !out[i]);
  if (missing.length) {
    const raw = (await postJson("/embeddings", {
      model: EMBED_MODEL,
      input: missing.map((m) => m.t),
    })) as { data?: { embedding: number[] }[] };
    embedStats.sent += missing.length;
    const vecs = (raw.data ?? []).map((d) => d.embedding);
    if (vecs.length !== missing.length) {
      throw new Error(`임베딩 개수 불일치: ${vecs.length} vs ${missing.length}`);
    }
    for (let k = 0; k < missing.length; k++) {
      out[missing[k].i] = vecs[k];
      await cacheSet(keyOf("embed1", EMBED_MODEL, missing[k].t), vecs[k]);
    }
  }
  return out as number[][];
}

/** 짧은 JSON 호출 — `나` 요약 갱신처럼 스키마가 작은 보조 호출. 캐시한다. */
export async function askJson<T>(
  systemPrompt: string,
  userMessage: string,
  schema: Record<string, unknown>,
  name: string,
): Promise<{ value: T; cached: boolean }> {
  const key = keyOf("json", name, CHAT_MODEL, JSON.stringify(SAMPLING), systemPrompt, userMessage);
  const hit = await cacheGet<T>(key);
  if (hit) return { value: hit, cached: true };
  checkBudget();
  const t0 = Date.now();
  const raw = (await postJson("/chat/completions", {
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    max_tokens: 32_000,
    ...SAMPLING,
  })) as { choices?: { message?: { content?: string } }[]; usage?: Usage };
  recordUsage(raw, Date.now() - t0);
  const content = raw.choices?.[0]?.message?.content;
  if (!content) throw new Error(`빈 응답: ${JSON.stringify(raw).slice(0, 300)}`);
  const value = JSON.parse(unfence(content)) as T;
  await cacheSet(key, value);
  return { value, cached: false };
}

export const MODELS = { chat: CHAT_MODEL, embed: EMBED_MODEL };

/**
 * 계정 잔액(달러). Kimi 만 있다 — 실비가 나가는 실행은 시작과 끝에 진짜 잔액을 찍는다.
 * 어림한 비용과 청구된 비용이 어긋나면 여기서 드러난다. 없으면 null.
 */
export async function balance(): Promise<number | null> {
  if (!IS_KIMI) return null;
  try {
    const res = await fetch(`${ENDPOINT}/users/me/balance`, {
      headers: { authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const raw = (await res.json()) as { data?: { available_balance?: number } };
    return raw.data?.available_balance ?? null;
  } catch {
    return null;
  }
}
