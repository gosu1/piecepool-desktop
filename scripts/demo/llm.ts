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

function apiKey(): string {
  const k = process.env.GEMINI_API_KEY;
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

/** 429·5xx 만 재시도한다. 400·401 은 다시 불러도 같은 답이다. */
async function postJson(path: string, body: unknown): Promise<unknown> {
  const url = `${ENDPOINT}${path}`;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (e: unknown) {
      // 시간 초과와 네트워크 오류도 잠시 뒤에는 풀린다. 응답이 느려진 날 60초에서 죽었다.
      if (attempt >= 10) throw e;
      const wait = Math.min(2000 * 2 ** attempt, 120_000);
      console.warn(`  ! ${e instanceof Error ? e.name : "fetch"} — ${wait / 1000}s 뒤 재시도`);
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

/** 위키 작성 호출. 캐시가 있으면 부르지 않는다. */
export async function writeWiki(
  systemPrompt: string,
  userMessage: string,
  opts: { noCache?: boolean } = {},
): Promise<{ pages: LlmPage[]; cached: boolean }> {
  const key = keyOf("chat", CHAT_MODEL, systemPrompt, userMessage);
  if (!opts.noCache) {
    const hit = await cacheGet<{ pages: LlmPage[] }>(key);
    if (hit) return { pages: hit.pages, cached: true };
  }

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
    temperature: 0.2,
  })) as { choices?: { message?: { content?: string } }[] };

  const content = raw.choices?.[0]?.message?.content;
  if (!content) throw new Error(`빈 응답: ${JSON.stringify(raw).slice(0, 300)}`);

  const parsed = JSON.parse(content) as { pages: LlmPage[] };
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
  const key = keyOf("json", name, CHAT_MODEL, systemPrompt, userMessage);
  const hit = await cacheGet<T>(key);
  if (hit) return { value: hit, cached: true };
  const raw = (await postJson("/chat/completions", {
    model: CHAT_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    temperature: 0.2,
  })) as { choices?: { message?: { content?: string } }[] };
  const content = raw.choices?.[0]?.message?.content;
  if (!content) throw new Error(`빈 응답: ${JSON.stringify(raw).slice(0, 300)}`);
  const value = JSON.parse(content) as T;
  await cacheSet(key, value);
  return { value, cached: false };
}

export const MODELS = { chat: CHAT_MODEL, embed: EMBED_MODEL };
