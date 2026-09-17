// OWNER: A — 4단계에서 확정 (2026-09-17). 툴콜 없음: AI 는 JSON 하나를 내고 코드가 파일을 쓴다 (ADR-0002 결정 2).
//
// OpenAI 호환 엔드포인트를 fetch 로 직접 쓴다. 패키지를 늘리지 않는다. 기본은 Kimi K3,
// reasoning_effort low (2026-09-15 합의 · 09-17 실측). Gemini 도 같은 형식이라 base URL 만 바꾸면 된다.
//
// 키와 설정은 환경 변수로 받는다 — core 는 호출자를 모르므로, CLI 는 `--env-file=.env` 로,
// 앱은 main/keys.ts 가 safeStorage 에서 읽어 process.env 에 올린 뒤 부른다.
import { PiecePoolError } from "../errors.ts";

export interface LlmMessage {
  role: "user" | "model";
  text: string;
}

/** 자유 텍스트 응답. 쿼리(B) 가 쓴다 — 6단계에서 채운다. */
export async function generate(messages: LlmMessage[]): Promise<string> {
  throw new Error("unimplemented: core/llm/chat.generate");
}

type Config = {
  url: string;
  key: string;
  model: string;
  sampling: Record<string, unknown>;
  isKimi: boolean;
};

function config(): Config {
  const key = process.env.PIECEPOOL_LLM_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) {
    throw new PiecePoolError("llm_failed", "LLM API 키가 없다 — PIECEPOOL_LLM_API_KEY 를 설정한다");
  }
  const model = process.env.PIECEPOOL_LLM_MODEL ?? "kimi-k3";
  const isKimi = model.startsWith("kimi");
  // Kimi 는 temperature 등을 고정값으로 요구한다("omit them from requests"). 추론 깊이만 고른다.
  // k2.6 은 reasoning_effort 를 모른다 — 보내면 8.6k 토큰을 생각한 뒤 답을 거의 안 냈다 (09-16 실측).
  const sampling =
    model === "kimi-k3"
      ? { reasoning_effort: process.env.PIECEPOOL_REASONING_EFFORT ?? "low" }
      : isKimi
        ? { thinking: { type: "disabled" } }
        : { temperature: 0.2 };
  return {
    url: process.env.PIECEPOOL_LLM_BASE_URL ?? "https://api.moonshot.ai/v1",
    key,
    model,
    sampling,
    isKimi,
  };
}

/** 1M 토큰당 달러 — 입력(캐시 안 됨) · 입력(캐시 됨) · 출력. 없는 모델은 토큰만 센다. */
const PRICES: Record<string, { in: number; hit: number; out: number }> = {
  "kimi-k3": { in: 3, hit: 0.3, out: 15 },
  "kimi-k2.6": { in: 0.95, hit: 0.16, out: 4 },
};

/** 호출 한 번의 토큰과 비용. 실비가 나가므로 호출부가 진행 로그에 찍는다. */
export interface CallUsage {
  prompt: number;
  cached: number;
  completion: number;
  reasoning: number;
  /** 요금표에 없는 모델은 null. */
  usd: number | null;
  ms: number;
}

export function usageLine(u: CallUsage): string {
  return (
    `토큰 입력 ${u.prompt} (캐시 ${u.cached}) · 출력 ${u.completion} (추론 ${u.reasoning})` +
    `${u.usd === null ? "" : ` · $${u.usd.toFixed(4)}`} · ${(u.ms / 1000).toFixed(1)}s`
  );
}

type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

function toUsage(model: string, u: RawUsage | undefined, ms: number): CallUsage {
  const prompt = u?.prompt_tokens ?? 0;
  const completion = u?.completion_tokens ?? 0;
  const cached = u?.prompt_tokens_details?.cached_tokens ?? u?.cached_tokens ?? 0;
  const reasoning = u?.completion_tokens_details?.reasoning_tokens ?? 0;
  const p = PRICES[model];
  const usd = p ? ((prompt - cached) * p.in + cached * p.hit + completion * p.out) / 1e6 : null;
  return { prompt, cached, completion, reasoning, usd, ms };
}

/** JSON Schema — Structured Outputs 로 형식을 강제한다. ADR-0002 결정 2 의 스키마. */
export const PAGES_SCHEMA = {
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
          // "몰랐다" 와 "알았다" 가 한 절에 날짜 없이 쌓인다. 다시 쓰게 하면 새 사실이
          // 기존 문장에 녹고, 시간순은 기록 절이 보존한다.
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

/** 형식 불량 — JSON 이 아니거나 빈 응답. 호출부가 이 항목만 건너뛴다 (잦으면 멈춘다). */
export class LlmFormatError extends PiecePoolError {
  constructor(message: string) {
    super("llm_failed", message);
    this.name = "LlmFormatError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 429·5xx 만 재시도한다. 400·401 은 다시 불러도 같은 답이다.
 *
 * 시간 초과는 다르다 — 클라이언트가 끊어도 서버는 생성을 마치고 과금할 수 있다.
 * Kimi 는 추론이 길어 600초까지 기다리고, 그래도 넘으면 한 번만 다시 부른다 (이중 과금 가능).
 */
async function postJson(c: Config, path: string, body: unknown): Promise<unknown> {
  const timeoutMs = c.isKimi ? 600_000 : 120_000;
  const maxNetRetries = c.isKimi ? 1 : 5;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${c.url}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${c.key}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: unknown) {
      if (attempt >= maxNetRetries) {
        throw new PiecePoolError(
          "llm_failed",
          `네트워크 실패: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      await sleep(Math.min(2000 * 2 ** attempt, 120_000));
      continue;
    }
    if (res.ok) return await res.json();
    const text = await res.text();
    const retriable = res.status === 429 || res.status >= 500;
    // 하루 한도(RPD)는 기다려도 안 풀린다. 바로 멈춘다.
    const daily = res.status === 429 && /PerDay/.test(text);
    if (!retriable || daily || attempt >= 5) {
      throw new PiecePoolError(
        "llm_failed",
        `${res.status} ${res.statusText} — ${text.replace(/\s+/g, " ").slice(0, 500)}`,
      );
    }
    await sleep(Math.min(2000 * 2 ** attempt, 120_000));
  }
}

/** k2.6 은 strict 스키마에도 가끔 ```json 울타리를 두른다 (문서가 "벗기고 파싱하라" 고 한다). */
function unfence(content: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(content);
  return m ? m[1] : content;
}

/** 스키마로 형식을 강제한 JSON 호출 하나. 위키 작성과 `나` 요약이 이것을 쓴다. */
export async function askJson<T>(
  systemPrompt: string,
  userMessage: string,
  schema: Record<string, unknown>,
  name: string,
): Promise<{ value: T; usage: CallUsage }> {
  const c = config();
  const t0 = Date.now();
  const raw = (await postJson(c, "/chat/completions", {
    model: c.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    // 폭주 벽. 추론 토큰까지 세므로 넉넉히 — 정상 출력은 2k 안팎이다.
    max_tokens: 32_000,
    ...c.sampling,
  })) as { choices?: { message?: { content?: string } }[]; usage?: RawUsage };
  const usage = toUsage(c.model, raw.usage, Date.now() - t0);
  const content = raw.choices?.[0]?.message?.content;
  if (!content) throw new LlmFormatError(`빈 응답: ${JSON.stringify(raw).slice(0, 300)}`);
  let value: T;
  try {
    value = JSON.parse(unfence(content)) as T;
  } catch (e: unknown) {
    throw new LlmFormatError(`JSON 이 아니다: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { value, usage };
}

/** 위키 작성 호출. */
export async function writeWiki(
  systemPrompt: string,
  userMessage: string,
): Promise<{ pages: LlmPage[]; usage: CallUsage }> {
  const { value, usage } = await askJson<{ pages: LlmPage[] }>(
    systemPrompt,
    userMessage,
    PAGES_SCHEMA,
    "wiki_pages",
  );
  return { pages: value.pages ?? [], usage };
}
