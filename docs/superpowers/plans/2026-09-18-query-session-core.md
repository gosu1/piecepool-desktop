# B1 쿼리 세션 코어 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 위키를 근거로 질문에 답하는 세션을 CLI 로 끝까지 돌린다 — AI 가 읽기 툴 4종으로 위키를 탐색하고, 답변에 근거를 달고, 세션 로그가 남는다.

**Architecture:** 코드가 검색어를 정하는 A(정리)와 달리, B(쿼리)는 AI 가 `search` 툴을 직접 부른다. 위키를 H2 절 단위로 색인해 BM25 로 점수를 매기고, 루프가 "실제로 연 절"을 모아 답변의 `[[페이지#절]]` 링크와 대조한다. 위키에 쓰지 않는다 — 반영은 B3(수확)의 몫이다.

**Tech Stack:** TypeScript (Node 22, ESM, `.ts` 확장자 import) · vitest · Kimi K3 (OpenAI 호환 엔드포인트를 `fetch` 로 직접)

**설계문서:** `docs/superpowers/specs/2026-09-17-query-session-design.md` (커밋 038c077)

## Global Constraints

- **새 npm 패키지를 설치하지 않는다.** Node 내장 + `fetch` 만 쓴다 (CLAUDE.md §2-2)
- **공유 타입은 `src/shared/types.ts` 에서만 가져온다.** 같은 모양을 다시 선언하지 않는다 (CLAUDE.md §4)
- **`// FROZEN:` 시그니처를 바꾸지 않는다** — `agent/tools.ts` 의 `createTools(v, w, o?)`, `agent/tasks/query.ts` 의 `ask(v, session, question, o?)`. 본체를 채우는 것은 동결 파기가 아니다
- **스텁 에러 메시지의 경로 표기를 유지한다** — `core/<모듈>.<함수>`
- **`src/core` 는 `process.exit` 를 부르지 않는다.** 에러는 `PiecePoolError` 로 던지고 `src/cli/run.ts` 가 종료 코드로 바꾼다
- **제목 정규화는 `index/links.ts` 의 `normalizeTitle()` 하나만 쓴다.** 본문 폴딩은 다른 함수(`foldText`)이고 이름을 겹치지 않는다
- **BM25 상수**: `k1 = 1.2` · `b = 0.75`. 측정 없이 바꾸지 않는다
- **검색 반환 상한**: 상위 `5` 절 · 한 페이지당 `2` 절 · 발췌 `600` 자
- **왕복 상한 기본값**: `8`. `PIECEPOOL_MAX_TURNS` 로 덮는다
- **주석은 한국어.** 기존 파일의 밀도와 어투를 따른다
- **커밋은 Conventional Commits. 타입은 영어, 설명은 한국어**
- **`main` 에 직접 push 하지 않는다.** 이 계획은 `design/query-session` 에서 갈라진 feature 브랜치에서 실행한다
- **검증 순서**: `npm ci && npx prettier --check . && npm run lint && npm run typecheck && npm test`

## File Structure

| 파일                                   | 책임                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| `src/core/index/search.ts`             | 절 단위 색인 빌드 + BM25 검색. 순수 계산 + 볼트 읽기              |
| `src/core/llm/chat.ts` (수정)          | `generate()` 를 툴콜용으로 넓힌다. 메시지 변환은 순수 함수로 뺀다 |
| `src/core/agent/tools.ts` (채움)       | 읽기 툴 4종. args 검증 실패를 예외가 아니라 결과로 돌려준다       |
| `src/core/agent/cite.ts`               | 답변의 `[[페이지#절]]` 을 연 경로와 대조한다. 순수 함수           |
| `src/core/agent/loop.ts` (채움)        | 툴콜 루프. 연 경로를 모으고 상한 도달을 표시한다                  |
| `src/core/agent/tasks/query.ts` (채움) | 세션 조립 — 색인 · 툴 · 루프 · 대조 · 로그 쓰기                   |
| `src/core/prompts/query.md` (수정)     | 쿼리 시스템 프롬프트                                              |
| `src/cli/query.ts` (수정)              | 대화 모드 추가                                                    |
| `fixtures/vault-life/eval-query.json`  | 정답 세트                                                         |
| `scripts/eval-query.ts`                | 정답 세트 채점 하네스                                             |

**의존 방향:** `search` → `tools` → `loop` → `query.ts`. `cite` 와 `chat` 은 독립이다.

---

## Task 1: 절 단위 색인과 BM25 검색

**Files:**

- Create: `src/core/index/search.ts`
- Test: `src/core/index/search.test.ts`

**Interfaces:**

- Consumes: `ingest/wiki.ts` 의 `WikiPage` · `readWikiPage` · `scanWiki`, `shared/types.ts` 의 `NotePath` · `Vault`
- Produces:
  - `foldText(s: string): string`
  - `tokens(text: string): string[]`
  - `interface Section { path: NotePath; page: string; heading: string; text: string }`
  - `interface Hit { path: NotePath; heading: string; score: number; text: string }`
  - `interface WikiIndex { sections: Section[]; tf: Map<string, number>[]; df: Map<string, number>; lens: number[]; avgLen: number }`
  - `indexPages(pages: WikiPage[]): WikiIndex`
  - `buildIndex(v: Vault): Promise<WikiIndex>`
  - `search(ix: WikiIndex, query: string, o?: { limit?: number }): Hit[]`

- [ ] **Step 1: 토크나이저의 실패 케이스를 테스트로 박는다**

`src/core/index/search.test.ts` 를 만든다.

```ts
// 쿼리 검색 — API 없이 확인한다.
import { describe, expect, it } from "vitest";
import { foldText, tokens } from "./search.ts";

describe("foldText", () => {
  it("공백을 지우지 않는다 — 로마자 단어 경계가 살아 있어야 한다", () => {
    expect(foldText("the OS is")).toBe("the os is");
  });
});

describe("tokens", () => {
  it("한글은 유니그램과 바이그램을 함께 낸다", () => {
    expect(tokens("잠들고")).toEqual(["잠", "들", "고", "잠들", "들고"]);
  });

  it("1글자 한글 질의어가 색인과 만난다 — 바이그램만이면 0건이 된다", () => {
    expect(tokens("잠")).toContain("잠");
    expect(tokens("잠들고")).toContain("잠");
  });

  it("로마자와 숫자는 낱말 통째로 둔다", () => {
    expect(tokens("DETR 5km")).toEqual(["detr", "5km"]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/index/search.test.ts`
Expected: FAIL — `Failed to resolve import "./search.ts"`

- [ ] **Step 3: 토크나이저를 쓴다**

`src/core/index/search.ts` 를 만든다.

```ts
// 쿼리 세션의 검색 — 절 단위 색인 + BM25.
//
// A(정리)의 후보 추리기와 부품이 갈라져 있다. A 는 질의가 노트 한 장이고 문서가 페이지지만,
// B 는 질의가 질문 한 줄이고 문서가 절이다. 같은 이름을 쓰지 않는 이유가 그것이다
// (설계 2026-09-17-query-session-design.md §4.0.1).
import type { NotePath, Vault } from "../../shared/types.ts";
import { readWikiPage, scanWiki, type WikiPage } from "../ingest/wiki.ts";

/**
 * 본문 폴딩. `index/links.ts` 의 `normalizeTitle` 과 목적이 다르다 —
 * 저쪽은 제목 키라 공백을 지우지만, 여기서 공백을 지우면
 * `the OS is` 가 `theosis` 가 되어 로마자 이름의 단어 경계가 사라진다.
 */
export function foldText(s: string): string {
  return s.normalize("NFC").toLowerCase();
}

/**
 * 한글은 조사가 붙어 낱말 경계가 없으므로 글자 조각으로 자른다.
 *
 * 유니그램을 함께 내는 것이 A 와 다른 점이다. 바이그램만 쓰면 1글자 질의어가
 * 색인과 **절대** 만나지 못한다 — `잠` 은 `[잠]`, `잠들고` 는 `[잠들, 들고]` 라
 * "요즘 잠 잘 자?" 가 0건이 됐다 (2026-09-17 실측).
 * 유니그램은 거의 모든 문서에 나와 IDF 가 알아서 점수를 죽인다.
 */
export function tokens(text: string): string[] {
  const out: string[] = [];
  for (const run of foldText(text).match(/[가-힣]+|[a-z0-9]+/g) ?? []) {
    if (!/^[가-힣]/.test(run)) {
      out.push(run);
      continue;
    }
    for (const ch of run) out.push(ch);
    for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
  }
  return out;
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/core/index/search.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 5: 색인이 페이지 이름을 담는지 테스트로 박는다**

`search.test.ts` 에 이어 붙인다.

```ts
import { hash8, type WikiPage } from "../ingest/wiki.ts";
import { indexPages, search } from "./search.ts";

function page(name: string, summary: string, secs: [string, string][] = []): WikiPage {
  return {
    path: `wiki/${name}.md`,
    name,
    fm: { hashes: {} },
    summary,
    sections: secs.map(([heading, content]) => ({
      heading,
      content,
      ours: true,
      hash: hash8(content),
    })),
    records: [],
    recordsOurs: true,
  };
}

const VAULT = [
  page("무릎 통증", "달리기를 시작한 뒤 왼쪽 무릎 바깥쪽이 아프다. 쉬면 나아진다.", [
    ["증상", "5km 를 넘기면 달리기 중에 바깥쪽이 시큰거린다."],
  ]),
  page("달리기", "9월에 시작했다. 주 3회 5km 를 뛴다.", [["페이스", "킬로미터당 6분 정도다."]]),
  page("수면", "늦게 자는 편이다. 커피를 줄이면 나아진다.", [
    ["패턴", "새벽 2시에 잠들고 8시에 깬다."],
  ]),
];

describe("indexPages", () => {
  it("요약도 절로 담는다", () => {
    const ix = indexPages(VAULT);
    expect(ix.sections.filter((s) => s.heading === "요약")).toHaveLength(3);
  });

  it("절 6개를 담는다 — 페이지 3장 × (요약 + 본문 절 1)", () => {
    expect(indexPages(VAULT).sections).toHaveLength(6);
  });
});

describe("search", () => {
  it("본문에 이름이 없는 절도 페이지 이름으로 찾는다", () => {
    // `증상` 절 본문에는 "무릎" 이 없다. 색인 텍스트에 페이지 이름이 들어가야 통과한다.
    const hits = search(indexPages(VAULT), "무릎");
    expect(hits.some((h) => h.path === "wiki/무릎 통증.md" && h.heading === "증상")).toBe(true);
  });

  it("회귀: 1글자 낱말만 있는 질문도 찾는다", () => {
    const hits = search(indexPages(VAULT), "요즘 잠 잘 자?");
    expect(hits[0].path).toBe("wiki/수면.md");
  });

  it("이름이 달라도 본문 낱말로 찾는다", () => {
    const hits = search(indexPages(VAULT), "커피 줄였나?");
    expect(hits[0].path).toBe("wiki/수면.md");
  });

  it("한 페이지가 2절을 넘지 않는다", () => {
    const many = [
      page("달리기", "달리기 요약", [
        ["가", "달리기 달리기"],
        ["나", "달리기 달리기"],
        ["다", "달리기 달리기"],
      ]),
    ];
    expect(search(indexPages(many), "달리기")).toHaveLength(2);
  });

  it("겹치는 낱말이 없으면 0건이다", () => {
    expect(search(indexPages(VAULT), "양자역학")).toEqual([]);
  });

  it("발췌를 600자에서 자른다", () => {
    const long = [page("긴글", "요약", [["본문", "달리기 " + "가".repeat(900)]])];
    const hit = search(indexPages(long), "달리기").find((h) => h.heading === "본문");
    expect(hit!.text.length).toBeLessThanOrEqual(600);
  });
});
```

- [ ] **Step 6: 실패를 확인한다**

Run: `npx vitest run src/core/index/search.test.ts`
Expected: FAIL — `indexPages is not a function`

- [ ] **Step 7: 색인과 검색을 쓴다**

`src/core/index/search.ts` 에 이어 붙인다.

```ts
/** 색인의 한 칸. `text` 는 돌려줄 표시용이고, 색인에 넣는 텍스트는 따로 만든다. */
export interface Section {
  path: NotePath;
  page: string;
  heading: string;
  text: string;
}

export interface Hit {
  path: NotePath;
  heading: string;
  score: number;
  text: string;
}

export interface WikiIndex {
  sections: Section[];
  /** 절마다 낱말 → 횟수. */
  tf: Map<string, number>[];
  /** 낱말 → 그 낱말이 나온 절 수. */
  df: Map<string, number>;
  lens: number[];
  avgLen: number;
}

// 교과서 값. 측정 없이 바꾸지 않는다.
const K1 = 1.2;
const B = 0.75;
const LIMIT = 5;
const PER_PAGE = 2;
const SNIPPET = 600;

/**
 * 색인에 넣는 텍스트 — 페이지 이름과 별칭을 **모든 절에** 넣는다.
 *
 * `무릎 통증.md` 의 `증상` 절 본문에는 "무릎" 이 없다. 이름이 파일명에만 있기 때문이다.
 * 절 본문만 색인하면 `무릎` 질의가 그 절을 놓친다. 이 한 줄이 A 의 글자 일치(`byLiteral`)를
 * 따로 옮기지 않아도 되게 만든다.
 */
function indexText(page: WikiPage, heading: string, content: string): string {
  return [page.name, ...(page.fm.aliases ?? []), heading, content].join("\n");
}

/** 페이지들을 절 단위로 펴서 색인한다. df·평균 길이를 여기서 한 번만 센다. */
export function indexPages(pages: WikiPage[]): WikiIndex {
  const sections: Section[] = [];
  const raw: string[] = [];

  for (const p of pages) {
    if (p.summary) {
      sections.push({ path: p.path, page: p.name, heading: "요약", text: p.summary });
      raw.push(indexText(p, "요약", p.summary));
    }
    for (const s of p.sections) {
      if (s.heading === "요약") continue; // readWikiPage 가 요약을 절에도 넣는다
      sections.push({ path: p.path, page: p.name, heading: s.heading, text: s.content });
      raw.push(indexText(p, s.heading, s.content));
    }
  }

  const docs = raw.map(tokens);
  const tf = docs.map((d) => {
    const m = new Map<string, number>();
    for (const t of d) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const lens = docs.map((d) => d.length);
  const avgLen = lens.length === 0 ? 0 : lens.reduce((a, n) => a + n, 0) / lens.length;

  return { sections, tf, df, lens, avgLen };
}

/** 볼트의 `wiki/` 를 읽어 색인한다. 세션 시작 때 한 번 부른다. */
export async function buildIndex(v: Vault): Promise<WikiIndex> {
  const pages: WikiPage[] = [];
  for (const p of await scanWiki(v)) pages.push(await readWikiPage(v, p));
  return indexPages(pages);
}

function idf(ix: WikiIndex, term: string): number {
  const n = ix.sections.length;
  const d = ix.df.get(term) ?? 0;
  return Math.log(1 + (n - d + 0.5) / (d + 0.5));
}

/**
 * BM25. 상위 `limit` 절을 돌려주되 한 페이지가 `PER_PAGE` 를 넘지 않는다 —
 * 한 페이지가 목록을 다 먹으면 다른 후보가 보이지 않는다.
 */
export function search(ix: WikiIndex, query: string, o?: { limit?: number }): Hit[] {
  if (ix.sections.length === 0) return [];
  const q = new Set(tokens(query));

  const scored: Hit[] = [];
  ix.sections.forEach((sec, i) => {
    let score = 0;
    for (const t of q) {
      const f = ix.tf[i].get(t);
      if (f === undefined) continue;
      const norm = K1 * (1 - B + (B * ix.lens[i]) / (ix.avgLen || 1));
      score += idf(ix, t) * ((f * (K1 + 1)) / (f + norm));
    }
    if (score > 0) {
      scored.push({
        path: sec.path,
        heading: sec.heading,
        score,
        text: sec.text.length > SNIPPET ? sec.text.slice(0, SNIPPET) : sec.text,
      });
    }
  });

  scored.sort((a, b) => b.score - a.score);

  const perPage = new Map<NotePath, number>();
  const out: Hit[] = [];
  for (const h of scored) {
    const n = perPage.get(h.path) ?? 0;
    if (n >= PER_PAGE) continue;
    perPage.set(h.path, n + 1);
    out.push(h);
    if (out.length >= (o?.limit ?? LIMIT)) break;
  }
  return out;
}
```

- [ ] **Step 8: 통과를 확인한다**

Run: `npx vitest run src/core/index/search.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 9: 전체 검증**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과

- [ ] **Step 10: 커밋**

```bash
git add src/core/index/search.ts src/core/index/search.test.ts
git commit -m "feat: 위키를 절 단위로 색인해 BM25 로 찾는다

1글자 한글 질의어가 바이그램 색인과 만나지 못해 \"요즘 잠 잘 자?\" 가 0건이 됐다.
유니그램을 함께 넣어 막는다. 페이지 이름을 모든 절의 색인 텍스트에 넣어
본문에 이름이 없는 절도 찾는다."
```

---

## Task 2: LLM 클라이언트에 툴콜을 싣는다

**Files:**

- Modify: `src/core/llm/chat.ts` (머리 주석 · `LlmMessage` · `generate`)
- Test: `src/core/llm/chat.test.ts`

**Interfaces:**

- Consumes: `chat.ts` 의 기존 `config()` · `postJson()` · `toUsage()` · `CallUsage`
- Produces:
  - `interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }`
  - `interface ToolCall { id: string; name: string; args: Record<string, unknown> }`
  - `type LlmMessage = { role: "user" | "model"; text: string } | { role: "tool"; callId: string; name: string; result: unknown }`
  - `toApiMessages(messages: LlmMessage[], system?: string): Record<string, unknown>[]`
  - `parseCalls(raw: unknown): { text: string; calls: ToolCall[] }`
  - `generate(messages: LlmMessage[], o?: { system?: string; tools?: ToolSpec[] }): Promise<{ text: string; calls: ToolCall[]; usage: CallUsage }>`

- [ ] **Step 1: 변환 함수의 테스트를 쓴다**

네트워크를 타는 부분은 테스트하지 않는다. 변환 두 개만 순수 함수로 빼서 잰다.
`src/core/llm/chat.test.ts` 를 만든다.

```ts
// 툴콜 메시지 변환 — 네트워크 없이 확인한다.
import { describe, expect, it } from "vitest";
import { parseCalls, toApiMessages } from "./chat.ts";

describe("toApiMessages", () => {
  it("model 을 assistant 로 바꾼다 — OpenAI 호환 이름이다", () => {
    const out = toApiMessages([{ role: "model", text: "안녕" }]);
    expect(out).toEqual([{ role: "assistant", content: "안녕" }]);
  });

  it("system 을 맨 앞에 끼운다", () => {
    const out = toApiMessages([{ role: "user", text: "질문" }], "너는 …");
    expect(out[0]).toEqual({ role: "system", content: "너는 …" });
  });

  it("툴 결과를 tool 역할과 tool_call_id 로 싣는다", () => {
    const out = toApiMessages([
      { role: "tool", callId: "c1", name: "search", result: { hits: [] } },
    ]);
    expect(out).toEqual([
      { role: "tool", tool_call_id: "c1", content: JSON.stringify({ hits: [] }) },
    ]);
  });
});

describe("parseCalls", () => {
  it("툴콜이 없으면 본문만 낸다", () => {
    const raw = { choices: [{ message: { content: "답입니다" } }] };
    expect(parseCalls(raw)).toEqual({ text: "답입니다", calls: [] });
  });

  it("arguments 를 JSON 으로 읽는다", () => {
    const raw = {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "c1", function: { name: "search", arguments: '{"query":"무릎"}' } }],
          },
        },
      ],
    };
    expect(parseCalls(raw)).toEqual({
      text: "",
      calls: [{ id: "c1", name: "search", args: { query: "무릎" } }],
    });
  });

  it("arguments 가 깨졌으면 빈 인자로 둔다 — 툴이 검증해서 결과로 알려준다", () => {
    const raw = {
      choices: [
        { message: { tool_calls: [{ id: "c1", function: { name: "search", arguments: "{" } }] } },
      ],
    };
    expect(parseCalls(raw).calls[0].args).toEqual({});
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/llm/chat.test.ts`
Expected: FAIL — `parseCalls is not a function`

- [ ] **Step 3: 머리 주석을 정리 한정으로 고친다**

`src/core/llm/chat.ts` 첫 줄을 바꾼다.

```ts
// OWNER: A — 4단계에서 확정 (2026-09-17). 정리(ingest)는 툴콜을 쓰지 않는다:
// AI 는 JSON 하나를 내고 코드가 파일을 쓴다 (ADR-0002 결정 2).
// 쿼리(B)는 읽기 툴 4종을 쥔다 — generate() 가 그쪽이다 (6단계, 2026-09-18).
```

- [ ] **Step 4: 타입과 변환 함수를 쓴다**

`chat.ts` 의 `LlmMessage` 선언을 지우고 아래로 바꾼다. `generate` 스텁은 Step 6 에서 채운다.

```ts
/** LLM 에게 보낼 툴 정의. `parameters` 는 JSON Schema 다. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** LLM 이 부르겠다고 한 툴 하나. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * 대화 한 칸. `tool` 은 우리가 툴을 실행하고 돌려주는 결과다.
 * 역할 이름이 OpenAI 와 다른 것은 `model` 뿐이라 변환에서 맞춘다.
 */
export type LlmMessage =
  | { role: "user" | "model"; text: string }
  | { role: "tool"; callId: string; name: string; result: unknown };

export function toApiMessages(messages: LlmMessage[], system?: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (system !== undefined) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.callId, content: JSON.stringify(m.result) });
    } else {
      out.push({ role: m.role === "model" ? "assistant" : "user", content: m.text });
    }
  }
  return out;
}

type RawChoice = {
  message?: {
    content?: string | null;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
  };
};

/**
 * 응답에서 본문과 툴콜을 꺼낸다.
 *
 * `arguments` 가 깨진 JSON 이어도 던지지 않는다 — 빈 인자로 두면 툴의 런타임 검증이
 * "인자가 없다" 를 결과로 돌려주고 AI 가 고쳐 다시 부른다. 여기서 던지면 세션이 죽는다.
 */
export function parseCalls(raw: unknown): { text: string; calls: ToolCall[] } {
  const msg = (raw as { choices?: RawChoice[] }).choices?.[0]?.message;
  const calls: ToolCall[] = [];
  for (const c of msg?.tool_calls ?? []) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(c.function?.arguments ?? "{}") as Record<string, unknown>;
    } catch {
      args = {};
    }
    calls.push({ id: c.id ?? "", name: c.function?.name ?? "", args });
  }
  return { text: msg?.content ?? "", calls };
}
```

- [ ] **Step 5: 변환 테스트 통과를 확인한다**

Run: `npx vitest run src/core/llm/chat.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 6: `generate()` 를 채운다**

`chat.ts` 의 `generate` 스텁을 바꾼다.

```ts
/**
 * 자유 텍스트 응답. 쿼리(B)가 쓴다.
 *
 * `tools` 를 주면 모델이 툴콜을 낼 수 있다. 부르는 쪽(`agent/loop.ts`)이
 * 실행하고 결과를 `role: "tool"` 로 붙여 다시 부른다.
 */
export async function generate(
  messages: LlmMessage[],
  o?: { system?: string; tools?: ToolSpec[] },
): Promise<{ text: string; calls: ToolCall[]; usage: CallUsage }> {
  const c = config();
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model: c.model,
    messages: toApiMessages(messages, o?.system),
    max_tokens: 32_000,
    ...c.sampling,
  };
  if (o?.tools?.length) {
    body.tools = o.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  const raw = (await postJson(c, "/chat/completions", body)) as { usage?: RawUsage };
  const { text, calls } = parseCalls(raw);
  return { text, calls, usage: toUsage(c.model, raw.usage, Date.now() - t0) };
}
```

- [ ] **Step 7: 전체 검증**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과. `stream.ts` 가 `LlmMessage` 를 타입으로만 쓰므로 그대로 컴파일된다

- [ ] **Step 8: 커밋**

```bash
git add src/core/llm/chat.ts src/core/llm/chat.test.ts
git commit -m "feat: LLM 클라이언트가 툴콜을 싣는다

generate() 가 쿼리(B)용으로 예약돼 있었는데 tools 인자가 없었다.
깨진 arguments 는 빈 인자로 두고 툴의 런타임 검증에 맡긴다 — 여기서 던지면 세션이 죽는다."
```

---

## Task 3: 읽기 툴 4종

**Files:**

- Modify: `src/core/agent/tools.ts` (`Tool` 에 `schema` 추가 · `createTools` 채움)
- Test: `src/core/agent/tools.test.ts`

**Interfaces:**

- Consumes: Task 1 의 `buildIndex` · `search` · `Hit`, `vault/notes.ts` 의 `readRaw`, `vault/tree.ts` 의 `readTree`, `index/scan.ts` 의 `scanVault`, `index/links.ts` 의 `backlinksOf` — **계획서가 "이미 구현됨" 으로 잘못 적었다. 실제로는 스텁이었고 Task 3 이 구현했다**
- Produces:
  - `Tool` 에 선택 필드 `schema?: { description: string; parameters: Record<string, unknown> }`
  - `createTools(v, w, o?: { readOnly?: boolean }): Tool[]` — **동결된 시그니처 그대로다.** 색인은 툴이 처음 쓸 때 안에서 만들어 세션 동안 재사용한다
  - 툴 결과 모양: `search` → `{ hits: Hit[]; note?: string }`, `read_note` → `{ text: string }`, `backlinks` → `{ paths: NotePath[] }`, `list_notes` → `{ paths: NotePath[] }`, 실패는 전부 `{ error: string }`

- [ ] **Step 1: 테스트를 쓴다**

`src/core/agent/tools.test.ts` 를 만든다.

```ts
// 읽기 툴 4종 — 실패가 예외가 아니라 결과로 온다.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../shared/types.ts";
import { openVault } from "../vault/open.ts";
import { createTools } from "./tools.ts";
import { Written } from "./written.ts";

let v: Vault;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "pp-tools-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(
    join(root, "wiki", "달리기.md"),
    "---\ncreated: 2026-09-01\n---\n\n# 달리기\n\n> 주 3회 5km 를 뛴다.\n\n## 페이스\n\n킬로미터당 6분.\n",
    "utf8",
  );
  await writeFile(
    join(root, "wiki", "무릎 통증.md"),
    "---\ncreated: 2026-09-02\n---\n\n# 무릎 통증\n\n> [[달리기]] 뒤에 아프다.\n",
    "utf8",
  );
  v = await openVault(root);
});

function toolsOf() {
  return createTools(v, new Written(), { readOnly: true });
}

/** 이름으로 툴 하나를 집는다. `createTools` 는 동기 함수다 — await 하지 않는다. */
function toolOf(name: string) {
  return toolsOf().find((t) => t.name === name)!;
}

describe("createTools", () => {
  it("읽기 전용이면 4종만 준다", () => {
    expect(
      toolsOf()
        .map((t) => t.name)
        .sort(),
    ).toEqual(["backlinks", "list_notes", "read_note", "search"]);
  });

  it("모든 툴이 schema 를 들고 있다 — LLM 에게 보낼 정의다", () => {
    for (const t of toolsOf()) expect(t.schema?.description).toBeTruthy();
  });
});

describe("read_note", () => {
  it("원문을 돌려준다", async () => {
    const r = (await toolOf("read_note").run({ path: "wiki/달리기.md" })) as { text: string };
    expect(r.text).toContain("킬로미터당 6분");
  });

  it("path 가 문자열이 아니면 던지지 않고 error 를 돌려준다", async () => {
    expect(await toolOf("read_note").run({ path: 42 })).toEqual({
      error: "path 는 문자열이어야 한다",
    });
  });

  it("볼트 밖 경로는 error 다", async () => {
    const r = (await toolOf("read_note").run({ path: "../밖.md" })) as { error: string };
    expect(r.error).toContain("볼트 밖");
  });

  it("없는 파일은 error 다", async () => {
    const r = (await toolOf("read_note").run({ path: "wiki/없다.md" })) as { error: string };
    expect(r.error).toContain("없는 파일");
  });
});

describe("search", () => {
  it("절을 찾는다", async () => {
    const r = (await toolOf("search").run({ query: "페이스" })) as { hits: { path: string }[] };
    expect(r.hits[0].path).toBe("wiki/달리기.md");
  });

  it("0건이면 그렇다고 알린다", async () => {
    expect(await toolOf("search").run({ query: "양자역학" })).toEqual({ hits: [], note: "0건" });
  });
});

describe("backlinks", () => {
  it("들어오는 링크를 돌려준다", async () => {
    const r = (await toolOf("backlinks").run({ path: "wiki/달리기.md" })) as { paths: string[] };
    expect(r.paths).toContain("wiki/무릎 통증.md");
  });
});

describe("list_notes", () => {
  it("glob 으로 좁힌다", async () => {
    const r = (await toolOf("list_notes").run({ glob: "wiki/*" })) as { paths: string[] };
    expect(r.paths.sort()).toEqual(["wiki/달리기.md", "wiki/무릎 통증.md"]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/agent/tools.test.ts`
Expected: FAIL — `unimplemented: core/agent/tools.createTools`

- [ ] **Step 3: `Tool` 에 `schema` 를 더한다**

`src/core/agent/tools.ts` 의 `Tool` 인터페이스를 바꾼다. 주석의 "지금 schema 필드를 지어내면 거짓 안정성이 된다" 두 줄을 아래로 교체한다.

```ts
// 4단계에 Tool 로 툴콜 스키마 같은 선택 필드가 추가되는 것은
// 동결 파기가 아니라 예정된 증분이다. 6단계(쿼리)가 그 시점이다.
// args 는 LLM 이 준 신뢰할 수 없는 JSON 이라 런타임 검증을 거친다 —
// 검증 실패는 던지지 않고 { error } 로 돌려준다. 던지면 세션이 죽고,
// 돌려주면 AI 가 고쳐 다시 부른다.

export interface Tool {
  name: ToolName;
  run(args: Record<string, unknown>): Promise<unknown>;
  /** LLM 에게 보낼 툴 정의. `parameters` 는 JSON Schema. */
  schema?: { description: string; parameters: Record<string, unknown> };
}
```

- [ ] **Step 4: `createTools` 를 채운다**

`tools.ts` 의 `createTools` 스텁을 바꾸고 import 를 더한다.

```ts
import { readRaw } from "../vault/notes.ts";
import { readTree } from "../vault/tree.ts";
import { scanVault } from "../index/scan.ts";
import { backlinksOf } from "../index/links.ts";
import { buildIndex, search, type WikiIndex } from "../index/search.ts";
import type { NotePath } from "../../shared/types.ts";
// TreeNode 는 shared/ipc.ts 에 있다 — index/scan.ts 도 거기서 가져온다.
import type { TreeNode } from "../../shared/ipc.ts";
```

```ts
/** LLM 이 준 값에서 문자열을 꺼낸다. 없거나 딴 타입이면 이유를 돌려준다. */
function str(args: Record<string, unknown>, key: string): string | { error: string } {
  const v = args[key];
  if (typeof v !== "string") return { error: `${key} 는 문자열이어야 한다` };
  return v;
}

function flatten(nodes: TreeNode[]): NotePath[] {
  const out: NotePath[] = [];
  for (const n of nodes) {
    if (n.kind === "file") out.push(n.path);
    else if (n.children !== undefined) out.push(...flatten(n.children));
  }
  return out;
}

/** `wiki/*` 같은 아주 작은 glob 만 받는다. `*` 는 `/` 를 넘지 않는다. */
function globToRe(glob: string): RegExp {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${esc}$`);
}

export function createTools(v: Vault, w: Written, o?: { readOnly?: boolean }): Tool[] {
  if (o?.readOnly !== true) {
    throw new Error("unimplemented: core/agent/tools.createTools");
  }

  // 색인은 처음 쓸 때 한 번 만들어 세션 동안 재사용한다.
  let wiki: WikiIndex | null = null;
  let links: Awaited<ReturnType<typeof scanVault>> | null = null;

  const tools: Tool[] = [
    {
      name: "search",
      schema: {
        description:
          "위키를 낱말로 찾는다. 절 단위로 점수가 높은 것부터 발췌와 함께 돌려준다. 0건이면 다른 말로 다시 불러 본다.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["query"],
          properties: { query: { type: "string" }, limit: { type: "number" } },
        },
      },
      async run(args) {
        const q = str(args, "query");
        if (typeof q !== "string") return q;
        wiki ??= await buildIndex(v);
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const hits = search(wiki, q, { limit });
        return hits.length === 0 ? { hits: [], note: "0건" } : { hits };
      },
    },
    {
      name: "read_note",
      schema: {
        description: "노트 원문을 통째로 읽는다. search 의 발췌로 모자랄 때 쓴다.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
      async run(args) {
        const p = str(args, "path");
        if (typeof p !== "string") return p;
        try {
          return { text: await readRaw(v, p) };
        } catch (e: unknown) {
          const code = (e as NodeJS.ErrnoException).code;
          if (code === "ENOENT") return { error: `없는 파일이다: ${p}` };
          return { error: `볼트 밖 경로이거나 읽을 수 없다: ${p}` };
        }
      },
    },
    {
      name: "backlinks",
      schema: {
        description: "이 노트를 가리키는 노트들을 돌려준다.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["path"],
          properties: { path: { type: "string" } },
        },
      },
      async run(args) {
        const p = str(args, "path");
        if (typeof p !== "string") return p;
        links ??= await scanVault(v);
        return { paths: backlinksOf(p, links.links) };
      },
    },
    {
      name: "list_notes",
      schema: {
        description:
          "노트 경로를 나열한다. glob 은 `wiki/*` 처럼 쓴다. search 가 0건일 때 어떤 페이지가 있는지 보는 데 쓴다.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { glob: { type: "string" } },
        },
      },
      async run(args) {
        const all = flatten(await readTree(v));
        if (args.glob === undefined) return { paths: all };
        const g = str(args, "glob");
        if (typeof g !== "string") return g;
        const re = globToRe(g);
        return { paths: all.filter((p) => re.test(p)) };
      },
    },
  ];

  return tools;
}
```

`w` 는 읽기 전용에서 쓰지 않는다 — eslint 가 `args: "none"` 이라 미사용 인자를 잡지 않는다.

- [ ] **Step 5: 통과를 확인한다**

Run: `npx vitest run src/core/agent/tools.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 6: 전체 검증**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add src/core/agent/tools.ts src/core/agent/tools.test.ts
git commit -m "feat: 쿼리 세션의 읽기 툴 4종

툴 실패는 예외가 아니라 결과다 — 던지면 세션이 죽고, 돌려주면 AI 가 스스로 복구한다.
Tool 에 schema 를 더한 것은 주석이 예고한 증분이다."
```

---

## Task 4: 근거 링크 대조

**Files:**

- Create: `src/core/agent/cite.ts`
- Test: `src/core/agent/cite.test.ts`

**Interfaces:**

- Consumes: 없음 (순수 함수)
- Produces:
  - `type Opened = Set<string>` — `"wiki/무릎 통증.md#증상"` 또는 페이지 전체를 연 경우 `"wiki/달리기.md"`
  - `checkCitations(answer: string, opened: Opened, resolve: (name: string) => string | null): { text: string; unsourced: number; dropped: string[] }`

- [ ] **Step 1: 테스트를 쓴다**

`src/core/agent/cite.test.ts` 를 만든다.

```ts
// 근거 대조 — 연 절을 가리키는 링크만 남긴다.
import { describe, expect, it } from "vitest";
import { checkCitations } from "./cite.ts";

// 이름 → 경로. 실제로는 index/links.ts 의 resolveLink 가 한다.
const resolve = (name: string) =>
  ({ "무릎 통증": "wiki/무릎 통증.md", 달리기: "wiki/달리기.md" })[name] ?? null;

const opened = new Set(["wiki/무릎 통증.md#증상", "wiki/달리기.md"]);

describe("checkCitations", () => {
  it("연 절을 가리키는 링크는 그대로 둔다", () => {
    const r = checkCitations("아프다. [[무릎 통증#증상]]", opened, resolve);
    expect(r.text).toBe("아프다. [[무릎 통증#증상]]");
    expect(r.dropped).toEqual([]);
  });

  it("페이지 전문을 열었으면 그 페이지의 어느 절이든 통과한다", () => {
    const r = checkCitations("주 3회 뛴다. [[달리기#페이스]]", opened, resolve);
    expect(r.dropped).toEqual([]);
  });

  it("연 적 없는 절의 링크는 뗀다 — 글자는 남긴다", () => {
    const r = checkCitations("졸리다. [[무릎 통증#재활]]", opened, resolve);
    expect(r.text).toBe("졸리다. 무릎 통증#재활");
    expect(r.dropped).toEqual(["무릎 통증#재활"]);
  });

  it("볼트에 없는 페이지의 링크도 뗀다", () => {
    const r = checkCitations("음. [[없는페이지]]", opened, resolve);
    expect(r.text).toBe("음. 없는페이지");
    expect(r.dropped).toEqual(["없는페이지"]);
  });

  it("링크 없는 문단을 unsourced 로 센다", () => {
    const r = checkCitations("첫 문단.\n\n둘째 문단. [[달리기]]\n\n셋째 문단.", opened, resolve);
    expect(r.unsourced).toBe(2);
  });

  it("표시 텍스트가 있는 링크도 읽는다", () => {
    const r = checkCitations("여기. [[무릎 통증#증상|무릎]]", opened, resolve);
    expect(r.dropped).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/agent/cite.test.ts`
Expected: FAIL — `Failed to resolve import "./cite.ts"`

- [ ] **Step 3: 구현한다**

`src/core/agent/cite.ts` 를 만든다.

```ts
// 근거 대조 — 답변의 [[페이지#절]] 이 이번 세션에서 실제로 연 절인지 본다.
//
// 이것은 증명이 아니라 필터다. 코드가 아는 것은 "그 절을 열었는가" 뿐이고,
// "그 문장이 그 절에서 나왔는가" 는 모른다. 근거를 사칭한 문단은 사람이 본다
// (설계 §3.3 · §10.6).

/** 이번 세션에서 실제로 본 것. `path#heading` 또는 전문을 연 `path`. */
export type Opened = Set<string>;

/**
 * `index/links.ts` 의 `parseLinks` 를 쓸 수 없다 — 그쪽은 `#page=N` 만 남기고
 * 헤딩 fragment 를 버린다. `LinkRef` 는 shared 의 FROZEN 이라 필드를 더하려면
 * 합의가 필요하므로, fragment 만 여기서 따로 읽는다.
 */
const LINK = /\[\[([^\]|#]+)(?:#([^\]|]+))?(?:\|([^\]]*))?\]\]/g;

export function checkCitations(
  answer: string,
  opened: Opened,
  resolve: (name: string) => string | null,
): { text: string; unsourced: number; dropped: string[] } {
  const dropped: string[] = [];

  const text = answer.replace(LINK, (whole, rawName: string, rawHeading?: string) => {
    const name = rawName.trim();
    const heading = rawHeading?.trim();
    const path = resolve(name);
    const ok =
      path !== null &&
      (opened.has(path) || (heading !== undefined && opened.has(`${path}#${heading}`)));
    if (ok) return whole;
    dropped.push(heading === undefined ? name : `${name}#${heading}`);
    // 링크만 벗기고 글자는 남긴다 — 정보를 잃지 않는다.
    return heading === undefined ? name : `${name}#${heading}`;
  });

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim() !== "");
  const unsourced = paragraphs.filter((p) => !/\[\[[^\]]+\]\]/.test(p)).length;

  return { text, unsourced, dropped };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/core/agent/cite.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: 전체 검증**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/core/agent/cite.ts src/core/agent/cite.test.ts
git commit -m "feat: 답변의 근거 링크를 연 절과 대조한다

세션이 위키 증식의 주 경로인데 수확의 quote 대조는 대화 본문을 자료로 보므로
AI 가 지어낸 문장도 통과한다. 연 적 없는 절을 가리킨 링크를 떼어 흔적을 남긴다."
```

---

## Task 5: 툴콜 루프

**Files:**

- Modify: `src/core/agent/loop.ts`
- Test: `src/core/agent/loop.test.ts`

**Interfaces:**

- Consumes: Task 2 의 `generate` · `ToolCall` · `ToolSpec` · `LlmMessage` · `CallUsage`, Task 3 의 `Tool`, Task 4 의 `Opened`
- Produces:
  - `interface AgentResult { text: string; opened: Opened; turns: number; toolCalls: number; hitCap: boolean; usage: CallUsage[] }`
  - `runAgent(prompt: string, input: string, tools: Tool[], o?: { onProgress?: OnProgress; history?: LlmMessage[]; maxTurns?: number; llm?: typeof generate }): Promise<AgentResult>`

`llm` 을 선택 인자로 둔 이유: 테스트가 가짜 LLM 을 끼워 네트워크 없이 루프를 잰다.

- [ ] **Step 1: 테스트를 쓴다**

`src/core/agent/loop.test.ts` 를 만든다.

```ts
// 툴콜 루프 — 가짜 LLM 으로 네트워크 없이 확인한다.
import { describe, expect, it } from "vitest";
import type { CallUsage, ToolCall } from "../llm/chat.ts";
import { runAgent } from "./loop.ts";
import type { Tool } from "./tools.ts";

const usage: CallUsage = { prompt: 0, cached: 0, completion: 0, reasoning: 0, usd: null, ms: 1 };

/** 대본대로 답하는 가짜 LLM. */
function fakeLlm(script: { text: string; calls: ToolCall[] }[]) {
  let i = 0;
  return async () => ({ ...script[Math.min(i++, script.length - 1)], usage });
}

const searchTool: Tool = {
  name: "search",
  async run() {
    return { hits: [{ path: "wiki/달리기.md", heading: "페이스", score: 1, text: "6분" }] };
  },
};

describe("runAgent", () => {
  it("툴콜이 없으면 그 텍스트가 답이다", async () => {
    const r = await runAgent("sys", "질문", [], { llm: fakeLlm([{ text: "답", calls: [] }]) });
    expect(r.text).toBe("답");
    expect(r.turns).toBe(1);
    expect(r.hitCap).toBe(false);
  });

  it("툴콜을 실행하고 결과를 붙여 다시 부른다", async () => {
    const r = await runAgent("sys", "질문", [searchTool], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "search", args: { query: "달리기" } }] },
        { text: "6분입니다", calls: [] },
      ]),
    });
    expect(r.text).toBe("6분입니다");
    expect(r.toolCalls).toBe(1);
  });

  it("search 가 돌려준 절을 opened 에 넣는다", async () => {
    const r = await runAgent("sys", "질문", [searchTool], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "search", args: {} }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.opened.has("wiki/달리기.md#페이스")).toBe(true);
  });

  it("read_note 는 페이지 전체를 opened 에 넣는다", async () => {
    const readTool: Tool = {
      name: "read_note",
      async run() {
        return { text: "전문" };
      },
    };
    const r = await runAgent("sys", "질문", [readTool], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "read_note", args: { path: "wiki/수면.md" } }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.opened.has("wiki/수면.md")).toBe(true);
  });

  it("실패한 툴 결과는 opened 에 넣지 않는다 — 근거가 될 수 없다", async () => {
    const bad: Tool = {
      name: "read_note",
      async run() {
        return { error: "없는 파일이다" };
      },
    };
    const r = await runAgent("sys", "질문", [bad], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "read_note", args: { path: "wiki/없다.md" } }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.opened.size).toBe(0);
  });

  it("없는 툴을 부르면 결과로 알리고 계속 돈다", async () => {
    const r = await runAgent("sys", "질문", [], {
      llm: fakeLlm([
        { text: "", calls: [{ id: "c1", name: "없는툴", args: {} }] },
        { text: "답", calls: [] },
      ]),
    });
    expect(r.text).toBe("답");
  });

  it("상한에 닿으면 툴을 떼고 한 번 더 불러 답을 받고 hitCap 을 세운다", async () => {
    // 계속 툴만 부르는 모델.
    const r = await runAgent("sys", "질문", [searchTool], {
      maxTurns: 2,
      llm: fakeLlm([{ text: "", calls: [{ id: "c1", name: "search", args: {} }] }]),
    });
    expect(r.hitCap).toBe(true);
    expect(r.turns).toBe(3); // 상한 2 + 툴 없는 마지막 호출
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/agent/loop.test.ts`
Expected: FAIL — `unimplemented: core/agent/loop.runAgent`

- [ ] **Step 3: 구현한다**

`src/core/agent/loop.ts` 전체를 바꾼다.

```ts
// OWNER: A — 6단계에서 쿼리(B)가 채웠다 (2026-09-18).
//
// 종료는 셋이다. ① 툴콜이 없으면 그 텍스트가 답이다 ② 왕복 상한에 닿으면
// 툴을 떼고 한 번 더 불러 답을 받는다 ③ LLM 호출 자체가 실패하면 던진다.
//
// ② 가 있는 이유: 상한에서 그냥 끊으면 "모델이 못 한 것" 과 "상한 아티팩트" 가
// 로그에서 구분되지 않는다. 2026-09-09 조회 스파이크가 겪은 일이다.
import type { OnProgress } from "../../shared/types.ts";
import { generate, type CallUsage, type LlmMessage, type ToolSpec } from "../llm/chat.ts";
import type { Opened } from "./cite.ts";
import type { Tool } from "./tools.ts";

export interface AgentResult {
  text: string;
  opened: Opened;
  turns: number;
  toolCalls: number;
  hitCap: boolean;
  usage: CallUsage[];
}

const DEFAULT_MAX_TURNS = 8;

function maxTurnsFromEnv(): number {
  const raw = Number(process.env.PIECEPOOL_MAX_TURNS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_TURNS;
}

/** 툴 결과에서 "실제로 본 것" 을 꺼낸다. 실패한 호출은 근거가 될 수 없어 넣지 않는다. */
function collectOpened(name: string, args: Record<string, unknown>, result: unknown, into: Opened) {
  if (typeof result !== "object" || result === null || "error" in result) return;
  if (name === "search") {
    const hits = (result as { hits?: { path: string; heading: string }[] }).hits ?? [];
    for (const h of hits) into.add(`${h.path}#${h.heading}`);
  } else if (name === "read_note" && typeof args.path === "string") {
    into.add(args.path);
  }
}

function toSpecs(tools: Tool[]): ToolSpec[] {
  return tools
    .filter((t) => t.schema !== undefined)
    .map((t) => ({
      name: t.name,
      description: t.schema!.description,
      parameters: t.schema!.parameters,
    }));
}

export async function runAgent(
  prompt: string,
  input: string,
  tools: Tool[],
  o?: {
    onProgress?: OnProgress;
    /** 이전 턴들. 대화 모드가 넘긴다. */
    history?: LlmMessage[];
    maxTurns?: number;
    /** 테스트가 가짜 LLM 을 끼우는 자리. */
    llm?: typeof generate;
  },
): Promise<AgentResult> {
  const llm = o?.llm ?? generate;
  const maxTurns = o?.maxTurns ?? maxTurnsFromEnv();
  const messages: LlmMessage[] = [...(o?.history ?? []), { role: "user", text: input }];
  const opened: Opened = new Set();
  const usage: CallUsage[] = [];
  let turns = 0;
  let toolCalls = 0;

  while (turns < maxTurns) {
    turns++;
    const res = await llm(messages, { system: prompt, tools: toSpecs(tools) });
    usage.push(res.usage);

    if (res.calls.length === 0) {
      return { text: res.text, opened, turns, toolCalls, hitCap: false, usage };
    }

    messages.push({ role: "model", text: res.text });
    for (const call of res.calls) {
      toolCalls++;
      const tool = tools.find((t) => t.name === call.name);
      const result = tool ? await tool.run(call.args) : { error: `그런 툴은 없다: ${call.name}` };
      collectOpened(call.name, call.args, result, opened);
      o?.onProgress?.({ step: "툴", detail: `${call.name} ${JSON.stringify(call.args)}` });
      messages.push({ role: "tool", callId: call.id, name: call.name, result });
    }
  }

  // 상한 — 툴을 떼고 한 번 더 부른다. 이 호출은 상한 밖이다.
  o?.onProgress?.({ step: "왕복 상한", detail: `${maxTurns}회 — 가진 근거로 답하게 한다` });
  turns++;
  const last = await llm(
    [
      ...messages,
      { role: "user", text: "지금까지 얻은 근거만으로 답하고, 모자라면 모자란다고 말하십시오." },
    ],
    { system: prompt },
  );
  usage.push(last.usage);
  return { text: last.text, opened, turns, toolCalls, hitCap: true, usage };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/core/agent/loop.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: 전체 검증**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/core/agent/loop.ts src/core/agent/loop.test.ts
git commit -m "feat: 툴콜 루프 — 상한에 닿아도 빈손으로 끝내지 않는다

상한에서 그냥 끊으면 모델이 못 한 것과 상한 아티팩트가 구분되지 않는다.
툴을 떼고 한 번 더 불러 답을 받고 hitCap 으로 성격을 표시한다.
성공한 툴 결과만 opened 에 넣는다 — 실패한 호출은 근거가 될 수 없다."
```

---

## Task 6: 세션 조립 · 로그 · 프롬프트 · 대화 모드

`QuerySession` 을 넓히면 `cli/query.ts` 가 곧바로 깨지므로 **한 태스크에서 함께 고친다.**
커밋마다 `npm run typecheck` 가 통과해야 한다는 Global Constraints 를 지키기 위해서다.

**Files:**

- Modify: `src/core/agent/tasks/query.ts`
- Modify: `src/core/prompts/query.md`
- Modify: `src/cli/query.ts`
- Test: `src/core/agent/tasks/query.test.ts`

**Interfaces:**

- Consumes: Task 1 `buildIndex`, Task 3 `createTools` · `Tool`, Task 4 `checkCitations`, Task 5 `runAgent`, `index/scan.ts` 의 `scanVault`, `index/links.ts` 의 `resolveLink`, `prompts/load.ts` 의 `loadPrompt`
- Produces:
  - `ask(v, session, question, o?)` 가 답을 돌려주고 `.piecepool/sessions/<id>.md` 를 쓴다
  - `buildSessionLog(meta: SessionMeta, turns: Turn[]): string`
  - `QuerySession` 에 `turns: Turn[]` · `history: LlmMessage[]` · `tools?: Tool[]` 추가
  - `npm run query -- <볼트> [질문]` — 질문이 없으면 대화 모드

- [ ] **Step 1: 테스트를 쓴다**

`src/core/agent/tasks/query.test.ts` 를 만든다. LLM 은 환경 변수가 없으면 던지므로, 이 테스트는 **로그 쓰기와 형식**만 잰다 — 루프는 Task 5 가 덮는다.

```ts
// 세션 로그 — A 의 수확이 읽을 형식이다.
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Vault } from "../../../shared/types.ts";
import { openVault } from "../../vault/open.ts";
import { buildSessionLog } from "./query.ts";

let v: Vault;

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "pp-query-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(join(root, "wiki", "달리기.md"), "# 달리기\n\n> 주 3회.\n", "utf8");
  v = await openVault(root);
});

const meta = {
  id: "2026-09-18-1432",
  model: "kimi-k3",
  turns: 2,
  toolCalls: 1,
  hitCap: false,
  tokens: { in: 100, cached: 50, out: 20 },
  usd: 0.001,
  opened: ["wiki/달리기.md#요약"],
  unsourced: 0,
};

describe("buildSessionLog", () => {
  it("턴을 `## N턴 (사용자)` · `## N턴 (AI)` 로 쓴다 — 수확이 이 형식을 전제한다", () => {
    const md = buildSessionLog(meta, [
      { who: "사용자", text: "얼마나 뛰어?" },
      { who: "AI", text: "주 3회입니다. [[달리기#요약]]" },
    ]);
    expect(md).toContain("## 1턴 (사용자)");
    expect(md).toContain("## 2턴 (AI)");
  });

  it("계기는 프론트매터에만 둔다 — 본문에 섞으면 수확이 사실로 읽는다", () => {
    const md = buildSessionLog(meta, [{ who: "사용자", text: "질문" }]);
    const body = md.slice(md.indexOf("\n---\n", 4) + 5);
    expect(body).not.toContain("kimi-k3");
    expect(body).not.toContain("turns");
  });

  it("연 경로와 unsourced 를 프론트매터에 남긴다", () => {
    const md = buildSessionLog(meta, [{ who: "사용자", text: "질문" }]);
    expect(md).toContain("  - wiki/달리기.md#요약");
    expect(md).toContain("unsourced: 0");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/agent/tasks/query.test.ts`
Expected: FAIL — `buildSessionLog is not exported`

- [ ] **Step 3: 구현한다**

`src/core/agent/tasks/query.ts` 를 바꾼다. `// FROZEN:` 머리 주석과 `ask` 시그니처는 그대로 둔다.

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OnProgress, Vault } from "../../../shared/types.ts";
import { loadPrompt } from "../../prompts/load.ts";
import { resolveLink } from "../../index/links.ts";
import { scanVault } from "../../index/scan.ts";
import { checkCitations } from "../cite.ts";
import { runAgent } from "../loop.ts";
import { createTools } from "../tools.ts";

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
  const ix = await scanVault(v);
  const cited = checkCitations(res.text, res.opened, (name) => resolveLink("", name, ix.targets));

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
```

`QuerySession` 을 아래로 넓힌다 (같은 파일, `// OWNER: B` 이므로 자유롭게 바꾼다).

```ts
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
}
```

import 를 더한다.

```ts
import type { LlmMessage } from "../../llm/chat.ts";
import type { Tool } from "../tools.ts";
import { Written } from "../written.ts";
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/core/agent/tasks/query.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: 프롬프트를 쓴다**

`src/core/prompts/query.md` 전체를 바꾼다.

````markdown
# query 프롬프트

당신은 사용자의 개인 위키를 근거로 질문에 답합니다.

## 도구

- `search(query)` — 위키를 낱말로 찾습니다. 절 단위로 발췌가 옵니다
- `read_note(path)` — 발췌로 모자라면 원문을 통째로 읽습니다
- `backlinks(path)` — 이 노트를 가리키는 노트들을 봅니다
- `list_notes(glob)` — `search` 가 0건일 때 어떤 페이지가 있는지 봅니다

## 규칙

### 1. 위키에 있는 것만 말하십시오

위키에서 찾지 못한 것은 **모른다고 말하십시오.** 일반 지식으로 채우지 마십시오.
사용자가 원하는 것은 "널리 알려진 답" 이 아니라 **자기가 적어 둔 것**입니다.

### 2. 답변의 각 문단 끝에 근거를 답니다

```
주 3회 5km 를 뛰고 있습니다. [[달리기#요약]]
```

**연 적 없는 절을 가리키지 마십시오.** 코드가 대조해서 떼어 냅니다.
근거가 없으면 링크 없이 그렇게 말하십시오 — 링크를 지어내는 것보다 낫습니다.

### 3. 0건이면 다른 말로 다시 찾으십시오

위키는 사용자가 쓴 말로 되어 있습니다. `유산소 운동` 이 없으면 `달리기` 로,
`수면 장애` 가 없으면 `잠` 으로 바꿔 보십시오. 그래도 없으면
`list_notes("wiki/*")` 로 어떤 페이지가 있는지 보십시오.

### 4. 대명사는 대화에서 풉니다

"그거 어떻게 됐지?" 는 앞 턴이 무엇을 다뤘는지 보고 실제 이름으로 바꿔 검색하십시오.
`그거` 를 그대로 검색하면 0건입니다.

### 5. 짧게 답하십시오

사용자는 자기가 쓴 것을 다시 읽으려는 것이지 요약문을 원하는 것이 아닙니다.
````

- [ ] **Step 6: CLI 에 대화 모드를 더한다**

`src/cli/query.ts` 전체를 바꾼다.

```ts
import { createInterface } from "node:readline/promises";
import { openVault } from "../core/vault/open.ts";
import { ask, type QuerySession } from "../core/agent/tasks/query.ts";
import { log, main } from "./run.ts";

function newSession(): QuerySession {
  // 콜론은 Windows 파일명에 쓸 수 없다 — 이 id 가 sessions/<id>.md 가 된다.
  return {
    id: new Date().toISOString().replace(/[:.]/g, "-"),
    log: "",
    turns: [],
    history: [],
  };
}

await main(async () => {
  const [vaultRoot, ...rest] = process.argv.slice(2);
  if (!vaultRoot) throw new Error("usage: npm run query -- <볼트경로> [질문]");

  const v = await openVault(vaultRoot);
  const session = newSession();
  const question = rest.join(" ");

  if (question) {
    console.log(await ask(v, session, question, { onProgress: log }));
    return;
  }

  // 대화 모드 — 대명사를 시험하려면 턴이 이어져야 한다.
  console.log(`볼트: ${vaultRoot} · 세션 ${session.id}`);
  console.log("질문을 입력하십시오. 빈 줄이나 Ctrl-C 로 끝냅니다.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const line = (await rl.question("> ")).trim();
      if (!line) break;
      console.log("\n" + (await ask(v, session, line, { onProgress: log })) + "\n");
    }
  } finally {
    rl.close();
  }
  console.log(`세션 로그: .piecepool/sessions/${session.id}.md`);
});
```

- [ ] **Step 7: 전체 검증**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과. `QuerySession` 변경과 `cli/query.ts` 수정이 한 태스크에 있으므로 중간에 깨지는 커밋이 없다

- [ ] **Step 8: 커밋**

```bash
git add src/core/agent/tasks/query.ts src/core/agent/tasks/query.test.ts src/core/prompts/query.md src/cli/query.ts
git commit -m "feat: 쿼리 세션 조립 · 로그 · 프롬프트 · 대화 모드

계기는 프론트매터에만 둔다 — 본문에 섞으면 수확이 왕복 수와 토큰을 사실로 읽는다.
연 경로와 unsourced 를 남겨 수확이 대화 출신 문장을 가릴 재료로 쓴다.
툴은 세션에 한 번만 만든다 — 매 턴 새로 만들면 위키 전체를 다시 읽는다.
질문 인자가 없으면 대화 모드로 들어간다 — 단발이면 대명사를 시험할 수 없다."
```

---

## Task 7: 정답 세트와 채점

**Files:**

- Create: `fixtures/vault-life/eval-query.json`
- Create: `scripts/eval-query.ts`

**Interfaces:**

- Consumes: Task 6 의 `ask` · `QuerySession`
- Produces: `node --env-file=.env scripts/eval-query.ts fixtures/vault-life` — 질문마다 열어야 할 페이지를 열었는지 채점

**선행 조건 (사람이 한다):** 이 태스크의 실행에는 위키가 필요하다. 세 픽스처 볼트 모두 `wiki/` 가 비어 있다.

```bash
node --env-file=.env scripts/demo/index.ts --vault fixtures/vault-life --bm25 --top 8 --limit 30
```

약 3,000~4,200원 · 35분 (K3 실측 단가). `npm run ingest` 를 쓰지 않는 이유는
`EngineOptions` 에 `--limit` 도 `--budget` 도 없어 87장 전부를 돌리기 때문이다 (설계 §10.4).

- [ ] **Step 1: 정답 세트를 쓴다**

`fixtures/vault-life/eval-query.json` 을 만든다. A 의 `eval.json` 과 같은 `|` 대안 표기를 쓴다.

```json
{
  "설명": "질문마다 세션이 열어야 할 페이지. 이름은 | 로 대안을 적는다. 답변 문장의 옳고 그름은 채점하지 않는다.",
  "questions": [
    { "q": "무릎 아픈 거 어떻게 됐지?", "must_open": ["러너스 니|장경인대 증후군|무릎 통증|무릎"] },
    { "q": "요즘 잠 잘 자?", "must_open": ["수면"] },
    { "q": "커피 줄였나?", "must_open": ["커피|수면"] },
    { "q": "달리기 얼마나 하고 있지?", "must_open": ["달리기"] },
    { "q": "캡스톤 어디까지 했지?", "must_open": ["캡스톤 프로젝트|캡스톤|도서관 좌석 알림 앱"] },
    { "q": "운영체제 수업에서 뭐 배웠지?", "must_open": ["프로세스|스레드|운영체제"] },
    { "q": "민지랑 무슨 얘기했더라?", "must_open": ["민지"] },
    { "q": "트랜스포머 이해했나?", "must_open": ["트랜스포머"] }
  ]
}
```

- [ ] **Step 2: 채점 하네스를 쓴다**

`scripts/eval-query.ts` 를 만든다.

```ts
// 정답 세트 채점 — 세션이 "열어야 할 페이지" 를 열었는가.
//
//   node --env-file=.env scripts/eval-query.ts fixtures/vault-life
//
// 답변 문장의 옳고 그름은 채점하지 않는다 (설계 §10.3 · §10.6).
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openVault } from "../src/core/vault/open.ts";
import { ask, type QuerySession } from "../src/core/agent/tasks/query.ts";
import { normalizeTitle } from "../src/core/index/links.ts";

type Eval = { questions: { q: string; must_open: string[] }[] };

const root = process.argv[2];
if (!root) throw new Error("usage: node scripts/eval-query.ts <볼트경로>");

const v = await openVault(root);
const spec = JSON.parse(await readFile(join(root, "eval-query.json"), "utf8")) as Eval;

/** 연 경로에서 페이지 이름만 뽑는다. `wiki/무릎 통증.md#증상` → `무릎 통증` */
function pageOf(opened: string): string {
  const file = opened.split("#")[0];
  return normalizeTitle((file.split("/").pop() ?? file).replace(/\.md$/i, ""));
}

let hit = 0;
const rows: string[] = [];

for (const { q, must_open } of spec.questions) {
  const session: QuerySession = {
    id: `eval-${Date.now()}`,
    log: "",
    turns: [],
    history: [],
  };
  await ask(v, session, q);
  const opened = new Set(
    (/^opened:\n((?:\s+- .*\n)*)/m.exec(session.log)?.[1] ?? "")
      .split("\n")
      .map((l) => l.replace(/^\s+-\s*/, "").trim())
      .filter(Boolean)
      .map(pageOf),
  );
  const ok = must_open.every((alt) =>
    alt.split("|").some((name) => opened.has(normalizeTitle(name))),
  );
  if (ok) hit++;
  rows.push(`${ok ? "O" : "X"}  ${q}\n     연 것: ${[...opened].join(", ") || "(없음)"}`);
}

console.log(rows.join("\n"));
console.log(
  `\n재현율 ${hit}/${spec.questions.length} (${((hit / spec.questions.length) * 100).toFixed(0)}%)`,
);
```

- [ ] **Step 3: 컴파일과 포맷을 확인한다**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과. `scripts/eval-query.ts` 는 테스트가 아니라 하네스라 `npm test` 가 잡지 않는다

- [ ] **Step 4: 커밋**

```bash
git add fixtures/vault-life/eval-query.json scripts/eval-query.ts
git commit -m "feat: 쿼리 정답 세트와 채점 하네스

검색 재현율만 자동으로 잰다 — 답변 문장의 옳고 그름은 사람이 본다.
목표 수치를 적지 않는다: 첫 측정이 기준선이고 카탈로그 A/B 가 그것과 비교한다."
```

- [ ] **Step 5: 사람이 하는 검증 (CLAUDE.md §7)**

위키를 만든 뒤 아래를 돌리고 **결과를 사람이 본다.**

```bash
node --env-file=.env scripts/eval-query.ts fixtures/vault-life
npm run query -- fixtures/vault-life
```

대화 모드에서 확인할 것:

1. `무릎 아픈 거 어떻게 됐지?` → 답이 나오고 `[[...]]` 근거가 붙는가
2. 이어서 `그거 좀 나아졌나?` → **대명사가 앞 턴으로 풀리는가**
3. `.piecepool/sessions/<id>.md` 에 `opened` · `unsourced` 가 남았는가
4. 답변에 **위키에 없는 사실**이 섞이지 않았는가 — 링크가 붙어 있어도 그 절에 없는 말을 했는지 본다

---

## Self-Review

**스펙 coverage:**

| 스펙                                    | 태스크   |
| --------------------------------------- | -------- |
| §5 `search` (색인·토크나이저·BM25·반환) | 1        |
| §8 LLM 툴콜                             | 2        |
| §6 툴 4종 · `Tool.schema`               | 3        |
| §6.1 연 경로 수집                       | 5        |
| §3.3 · §9.3 근거 대조                   | 4, 6, 7  |
| §7 루프 · 상한 · `hit_cap`              | 5        |
| §9.1 멀티턴 · 대화 모드                 | 6        |
| §9.2 로그 형식 · 계기                   | 6        |
| §5.6 색인을 세션 동안 재사용            | 6        |
| §10.1 툴 실패는 결과다                  | 3, 5     |
| §10.2 단위 테스트                       | 1~6      |
| §10.3 정답 세트                         | 7        |
| §10.4 선행 조건                         | 7 (사람) |
| §10.6 사람 몫                           | 7 Step 5 |

**손대지 않는 것 확인:** `llm/stream.ts` · `index/scan.ts` 의 `saveIndex`·`loadIndex` ·
`vault/notes.ts` 의 `readNote` 등 · `vault/paths.ts` 의 `assertAgentWritable` ·
`main/keys.ts` · `shared/ipc.ts` · `shared/types.ts` — 어느 태스크도 건드리지 않는다.

**이 계획이 하지 않는 것:** 카탈로그 조회(§11.1) · 스트리밍 · 취소 · 색인 영속화 ·
`sources/` 색인 · BM25 파라미터 조정 · A 구간의 회귀 수정(§12.1).
