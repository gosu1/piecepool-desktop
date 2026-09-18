# B4 답변 근거 표시 이관 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 답변의 문단 링크·`cite.ts`·`unsourced` 를 걷어내고, 위키를 먼저 찾되 위키에 매이지 않는 답변으로 바꾼다. 화면에는 코드가 `opened` 로 만든 "참고" 한 줄을 붙인다.

**Architecture:** `ask()` 의 동결 시그니처는 그대로 두고 안에서 `checkCitations` 호출을 `onProgress({ step: "참고" })` 보고로 바꾼다. 페이지 목록은 순수 함수 `openedPages()` 가 만든다(테스트 대상). `cite.ts` 는 지우고 `Opened` 타입만 `loop.ts` 로 옮긴다. 프롬프트 규칙 1 을 완화하고 규칙 2 를 지운다. 설계: `docs/superpowers/specs/2026-09-18-query-answer-grounding-design.md`.

**Tech Stack:** TypeScript (Node 22, `node --experimental-strip-types`) · vitest. 새 패키지 없음.

## Global Constraints

- 브랜치 `feat/query-harvest` 위에서 이어 간다. `main` 에 직접 push 하지 않는다
- 커밋: Conventional Commits, 타입 영어 · 설명 한국어. 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- FROZEN 시그니처를 바꾸지 않는다: `ask(v, session, question, o?: { onProgress? }): Promise<string>`
- `shared/` · `renderer/` · `main/` · `ingest/` 에 한 줄도 쓰지 않는다 (`prompts/query.md` 는 B 소유라 고친다)
- 공유 타입은 `src/shared/types.ts` 에서만 import 한다
- 커밋 전 `npx prettier --check . && npm run lint && npm run typecheck && npm test` 전부 통과
- 테스트 실행: `npx vitest run <파일>` (단일) · `npm test` (전체). 테스트는 실제 LLM 을 부르지 않는다
- 참고 줄 형식은 `[[달리기]] · [[무릎 통증]]` — 페이지 이름(`titleOf`), `#절` 없음, 정렬, 중복 없음. 연 것이 없으면 보고하지 않는다

---

### Task 1: `query.ts` — `unsourced` 제거 · `openedPages()` · 참고 보고

**Files:**

- Modify: `src/core/agent/tasks/query.ts`
- Modify: `src/cli/query.ts:44-49`
- Test: `src/core/agent/tasks/query.test.ts`

**Interfaces:**

- Consumes: `titleOf(p: NotePath): string` (`src/core/index/scan.ts`) · `AgentResult.opened: Set<string>` (`loop.ts`)
- Produces: `export function openedPages(opened: Iterable<string>): string[]` — 페이지 이름 배열, 정렬·중복 제거. `accumulate(prev, res)` 두 인자. `SessionMeta` · `SessionStats` 에 `unsourced` 없음

- [ ] **Step 1: 테스트를 새 계약으로 고친다**

`src/core/agent/tasks/query.test.ts` 를 통째로 이렇게 바꾼다:

```ts
// 세션 로그 — A 의 수확이 읽을 형식이다.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openVault } from "../../vault/open.ts";
import type { AgentResult } from "../loop.ts";
import { accumulate, buildSessionLog, openedPages } from "./query.ts";

beforeEach(async () => {
  const root = await mkdtemp(join(tmpdir(), "pp-query-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(join(root, "wiki", "달리기.md"), "# 달리기\n\n> 주 3회.\n", "utf8");
  await openVault(root);
});

const meta = {
  id: "2026-09-18-1432",
  model: "kimi-k3",
  date: "2026-09-18",
  turns: 2,
  toolCalls: 1,
  hitCap: false,
  tokens: { in: 100, cached: 50, out: 20 },
  usd: 0.001,
  opened: ["wiki/달리기.md#요약"],
};

describe("buildSessionLog", () => {
  it("턴을 `## N턴 (사용자)` · `## N턴 (AI)` 로 쓴다 — 수확이 이 형식을 전제한다", () => {
    const md = buildSessionLog(meta, [
      { who: "사용자", text: "얼마나 뛰어?" },
      { who: "AI", text: "주 3회입니다." },
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

  it("연 경로를 프론트매터에 남긴다. unsourced 는 없다 — 답변 링크가 사라져 셀 수 없다 (B4)", () => {
    const md = buildSessionLog(meta, [{ who: "사용자", text: "질문" }]);
    expect(md).toContain("  - wiki/달리기.md#요약");
    expect(md).not.toContain("unsourced");
  });

  it("세션 날짜를 date: 로 남긴다 — ingest 가 이것을 출처 날짜로 읽는다", () => {
    const md = buildSessionLog(meta, [{ who: "사용자", text: "질문" }]);
    expect(md).toContain("\ndate: 2026-09-18\n");
  });
});

describe("accumulate", () => {
  const res = (over: Partial<AgentResult> = {}): AgentResult => ({
    text: "",
    opened: new Set(["wiki/달리기.md#요약"]),
    turns: 2,
    toolCalls: 1,
    hitCap: false,
    usage: [{ prompt: 100, cached: 50, completion: 20, reasoning: 0, ms: 0, usd: 0.001 }],
    ...over,
  });

  it("두 번째 ask() 의 계기를 첫 번째 위에 더한다 — 앞 턴이 연 절이 로그에서 사라지지 않는다", () => {
    const a = accumulate(undefined, res());
    const b = accumulate(a, res({ opened: new Set(["wiki/수영.md#요약"]) }));
    expect(b.turns).toBe(4);
    expect(b.toolCalls).toBe(2);
    expect(b.tokens).toEqual({ in: 200, cached: 100, out: 40 });
    expect(b.usd).toBeCloseTo(0.002);
    expect([...b.opened].sort()).toEqual(["wiki/달리기.md#요약", "wiki/수영.md#요약"]);
  });

  it("한 번이라도 상한에 닿았으면 hit_cap 이 남는다 — 답이 잘렸을 수 있다는 표시다", () => {
    const a = accumulate(undefined, res({ hitCap: true }));
    expect(accumulate(a, res()).hitCap).toBe(true);
  });

  it("단가를 모르는 호출만 있으면 usd 는 null 이고, 하나라도 알면 아는 것만 더한다", () => {
    const unknown = res({
      usage: [{ prompt: 1, cached: 0, completion: 1, reasoning: 0, ms: 0, usd: null }],
    });
    expect(accumulate(undefined, unknown).usd).toBeNull();
    expect(accumulate(accumulate(undefined, unknown), res()).usd).toBeCloseTo(0.001);
  });
});

describe("openedPages", () => {
  it("절을 떼고 페이지 이름으로 합쳐 정렬한다 — 화면의 참고 줄 재료", () => {
    const pages = openedPages([
      "wiki/무릎 통증.md#재활",
      "wiki/달리기.md#요약",
      "wiki/달리기.md#기록",
      "wiki/달리기.md",
    ]);
    expect(pages).toEqual(["달리기", "무릎 통증"]);
  });

  it("연 것이 없으면 빈 배열이다 — 호출부가 참고 줄을 안 붙인다", () => {
    expect(openedPages([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/core/agent/tasks/query.test.ts`
Expected: FAIL — `openedPages` 를 export 하지 않아 import 에서 죽거나, `unsourced` 단언이 깨진다.

- [ ] **Step 3: `query.ts` 를 고친다**

`src/core/agent/tasks/query.ts` 에서:

(a) import 를 바꾼다 — `import { resolveLink } from "../../index/links.ts";` 와 `import { checkCitations } from "../cite.ts";` 두 줄을 지우고, `scan.ts` import 에 `titleOf` 를 더한다:

```ts
import { scanVault, titleOf, type VaultIndex } from "../../index/scan.ts";
```

(b) `SessionMeta` 에서 `unsourced: number;` 줄을 지운다.

(c) `SessionStats` 에서 `unsourced: number;` 줄을 지운다.

(d) `accumulate` 를 두 인자로 바꾼다:

```ts
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
```

(e) `buildSessionLog` 에서 `out.push(\`unsourced: ${meta.unsourced}\`);` 줄을 지운다.

(f) `buildSessionLog` 바로 아래에 순수 함수를 더한다:

```ts
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
```

(g) `ask()` 안에서 근거 대조 블록을 지우고 턴 기록을 원문으로 바꾼다:

```ts
const res = await runAgent(prompt, question, session.tools, {
  onProgress: o?.onProgress,
  history: session.history,
});

session.turns.push({ who: "사용자", text: question });
session.turns.push({ who: "AI", text: res.text });
session.history.push({ role: "user", text: question });
session.history.push({ role: "model", text: res.text });

session.stats = accumulate(session.stats, res);
```

(h) `ask()` 끝의 `if (cited.dropped.length) { ... }` 블록을 이것으로 바꾼다:

```ts
const pages = openedPages(res.opened);
if (pages.length) {
  o?.onProgress?.({ step: "참고", detail: pages.map((p) => `[[${p}]]`).join(" · ") });
}
return res.text;
```

(i) `ask()` 의 머리 주석 "읽기 전용 툴만 받는다 — 대화 중에는 위키를 고치지 않는다" 는 그대로 둔다. `QuerySession.index` 의 주석에 "근거 대조용" 이 있으면 "backlinks 툴용" 으로 고친다 — 이제 색인을 쓰는 곳은 툴뿐이다.

(j) `src/cli/query.ts` 의 `[y/N]` 안내를 바꾼다 — 그대로 두면 typecheck 가 깨진다:

```ts
    if (session.turns.length) {
      const pages = openedPages(session.stats?.opened ?? []).length;
      console.log(
        `세션 로그: .piecepool/sessions/${session.id}.md · ${session.turns.length / 2}턴 · 본 페이지 ${pages}장`,
      );
```

import 줄도 고친다:

```ts
import { ask, openedPages, type QuerySession } from "../core/agent/tasks/query.ts";
```

(`session.turns` 는 사용자·AI 가 한 쌍이라 `/ 2` 가 대화 턴 수다.)

- [ ] **Step 4: 통과를 확인한다**

Run: `npx vitest run src/core/agent/tasks/query.test.ts`
Expected: PASS (10 tests)

Run: `npm run typecheck && npm run lint`
Expected: 오류 없음. (`cite.ts` 는 아직 있으므로 `loop.ts` 는 멀쩡하다.)

- [ ] **Step 5: 커밋**

```bash
git add src/core/agent/tasks/query.ts src/core/agent/tasks/query.test.ts src/cli/query.ts
git commit -m "refactor: 답변의 근거 대조를 빼고 화면용 참고 보고로 바꾼다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `cite.ts` 삭제 · `Opened` 를 `loop.ts` 로

**Files:**

- Delete: `src/core/agent/cite.ts` · `src/core/agent/cite.test.ts`
- Modify: `src/core/agent/loop.ts:10-15`
- Modify: `src/core/agent/tasks/harvest.test.ts:40` (픽스처의 `unsourced: 0` 제거)

**Interfaces:**

- Produces: `export type Opened = Set<string>` in `src/core/agent/loop.ts`

- [ ] **Step 1: `harvest.test.ts` 픽스처에서 `unsourced` 를 뺀다**

`src/core/agent/tasks/harvest.test.ts` 의 `LOG` 상수에서 `unsourced: 0\n` 을 지운다:

```ts
const LOG =
  "---\nid: s1\nmodel: kimi-k3\ndate: 2026-09-18\nturns: 2\ntool_calls: 1\nhit_cap: false\ntokens: { in: 1, cached: 0, out: 1 }\n---\n\n## 1턴 (사용자)\n\n무릎이 아픈데 계속 뛰어도 될까?\n\n## 2턴 (AI)\n\n주당 10% 이상 늘리지 않는 것이 통설입니다.\n";
```

- [ ] **Step 2: `loop.ts` 가 `Opened` 를 직접 갖게 한다**

`src/core/agent/loop.ts` 에서 `import type { Opened } from "./cite.ts";` 줄을 지우고, `AgentResult` 위에 넣는다:

```ts
/** 이번 세션에서 실제로 본 것. `path#heading` 또는 전문을 연 `path`. */
export type Opened = Set<string>;

export interface AgentResult {
```

- [ ] **Step 3: `cite.ts` · `cite.test.ts` 를 지운다**

```bash
git rm src/core/agent/cite.ts src/core/agent/cite.test.ts
```

- [ ] **Step 4: 전체 검증**

Run: `npm test`
Expected: PASS. 총 테스트 수가 `cite.test.ts` 몫만큼 줄지만 0 이 아니다.

Run: `npm run lint`
Expected: 오류 없음.

Run: `npm run typecheck`
Expected: 오류 없음.

- [ ] **Step 5: 커밋**

```bash
git add src/core/agent/loop.ts src/core/agent/tasks/harvest.test.ts
git commit -m "refactor: cite.ts 를 지우고 Opened 타입을 loop.ts 로 옮긴다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(`git rm` 한 파일은 이미 스테이지에 있다.)

---

### Task 3: 프롬프트 규칙

**Files:**

- Modify: `src/core/prompts/query.md`

- [ ] **Step 1: `prompts/query.md` 규칙 1·2 를 고친다**

`## 규칙` 아래 `### 1.` 과 `### 2.` 절 전체를 이것으로 바꾼다 (3·4·5 는 그대로):

```markdown
### 1. 먼저 위키를 찾으십시오

있으면 그것으로 답하십시오. 사용자가 적어 둔 것이 있는데 일반 지식으로 답하지 마십시오.
위키에 없으면 일반 지식으로 답해도 됩니다.
```

그리고 규칙 번호를 당긴다 — 옛 3 → 2, 4 → 3, 5 → 4. 절 제목만 바꾸고 내용은 그대로 둔다.

- [ ] **Step 2: 검증**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과.

- [ ] **Step 3: 커밋**

```bash
git add src/core/prompts/query.md
git commit -m "feat: 답변은 위키를 먼저 찾되 위키에 매이지 않는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: 문서 세 곳

**Files:**

- Modify: `intent.md:71`
- Modify: `docs/superpowers/specs/2026-09-17-query-session-design.md:4`
- Modify: `docs/superpowers/specs/2026-09-18-query-harvest-design.md:27`

- [ ] **Step 1: `intent.md` "답한다" 기준**

71행의

```
| **답한다**        | 그 위키를 근거로 질문에 답하고, 답에 출처가 붙는다                                                       |
```

를

```
| **답한다**        | 위키를 먼저 찾아 답하고, 답 끝에 어느 페이지를 봤는지 붙는다                                             |
```

로 바꾼다. (표 정렬은 prettier 가 맞춘다.)

- [ ] **Step 2: B1 설계 상태 줄**

`2026-09-17-query-session-design.md` 4행 `- 상태: 설계 승인됨 (구현 계획 대기)` 아래에 한 줄을 넣는다:

```
- 대체됨 (일부): §3(근거 대조) · §11.2 는 `2026-09-18-query-answer-grounding-design.md` 로 대체됐다 (2026-09-18)
```

- [ ] **Step 3: B3 설계 결정 1**

`2026-09-18-query-harvest-design.md` 27행 결정 표의 첫 행 "택한 것" 칸 앞에 `**폐기 (2026-09-18, B4)** — ` 를 붙인다:

```
| ③(AI 사전지식) 거르기 | **폐기 (2026-09-18, B4)** — 대상(답변의 ③ 거르기)이 사라졌다. `2026-09-18-query-answer-grounding-design.md` §1.2. 원래 결정: **안 한다. 그대로 넘기고 잰다** | 근거 없는 AI 문단 제거 · lint 규칙 | 지금 있는 `(AI)` 꼬리표로 실제 세션을 수확해 ③ 이 얼마나 들어오는지 본 뒤 정한다. 측정 없이 거름을 짓지 않는다 (B1 설계 §11.2 와 같은 원칙) |
```

- [ ] **Step 4: prettier 로 표를 다시 맞추고 검증**

Run: `npx prettier --write intent.md docs/superpowers/specs/2026-09-17-query-session-design.md docs/superpowers/specs/2026-09-18-query-harvest-design.md && npx prettier --check .`
Expected: 통과.

- [ ] **Step 5: 커밋**

```bash
git add intent.md docs/superpowers/specs/2026-09-17-query-session-design.md docs/superpowers/specs/2026-09-18-query-harvest-design.md
git commit -m "docs: 답한다 기준을 고치고 B1·B3 의 대체된 절을 표시한다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 실측 (K3) 과 기록

**Files:**

- Modify: `docs/superpowers/specs/2026-09-18-query-answer-grounding-design.md` (§8.2 아래에 `### 8.3 첫 실측` 추가)

실제 LLM 을 부른다. `PIECEPOOL_LLM_*` 환경변수가 없으면 이 Task 는 사용자에게 넘긴다 (CLAUDE.md §7).

- [ ] **Step 1: 임시 볼트를 만든다**

```bash
VAULT=$(mktemp -d)/vault-life && cp -r fixtures/vault-life "$VAULT" && echo "$VAULT"
```

(레포 안 볼트에 중첩 `.git` 이 생기는 것을 피한다 — B3 §7.4 와 같은 이유.)

- [ ] **Step 2: ① 위키에 있는 질문**

```bash
npm run query -- "$VAULT" "무릎 아픈 거 어떻게 됐지?"
```

확인: 진행 로그에 `search` 호출이 있고 `참고: [[무릎 통증]]` (또는 관련 페이지) 줄이 있다. 답변 본문에 `[[` 나 `무릎 통증#재활` 같은 평문 잔해가 없다.

- [ ] **Step 3: ② 위키에 없는 질문 → ③ 수확**

대화 모드로 들어가 한 턴 묻고 `y` 로 수확한다:

```bash
npm run query -- "$VAULT"
> 러닝에서 10% 규칙이 뭐야?
>
위키에 반영? [y/N] y
```

확인: 답이 나온다(모른다고 하지 않는다). `참고:` 줄이 없다. 수확 뒤 `git -C "$VAULT" show --stat HEAD` 에 커밋 1개. `grep -rn "(AI)" "$VAULT/wiki"` 로 기록 줄에 `(AI)` 가 붙었거나, 진행 로그에 중복 검문이 막았다는 줄이 있다.

- [ ] **Step 4: ⑤ 사용자 자신에 관한 질문, 위키에 없음**

```bash
npm run query -- "$VAULT" "작년에 어디 여행 갔지?"
```

확인: 지어내지 않는다 (없다고 하거나 되묻는다). 지어내면 결과를 기록만 하고 프롬프트를 고치지 않는다 — 설계 §8.2 ⑤ 대로 사용자가 정한다.

- [ ] **Step 5: 설계문서 §8.3 에 기록한다**

`2026-09-18-query-answer-grounding-design.md` 의 `## 9. 범위 밖` 앞에 넣는다. B3 §7.4 형식을 따른다 — 날짜 · 모델 · 실비 · 통과 조건 표 · 함께 드러난 것:

```markdown
### 8.3 첫 실측 (2026-09-18, K3, 실비 $X.XX)

`fixtures/vault-life` 를 임시 폴더로 복사해 돌렸다.

| 통과 조건 (§8.2)   | 결과                                                 |
| ------------------ | ---------------------------------------------------- |
| ① 위키에 있는 질문 | (search 호출 · 참고 줄 · 잔해 없음 — 실제 출력 요약) |
| ② 위키에 없는 질문 | (답 · 참고 줄 없음)                                  |
| ③ ②를 수확         | (커밋 · `(AI)` 또는 중복 검문)                       |
| ④ 본문 잔해        | (없음/있음)                                          |
| ⑤ 자신에 관한 질문 | (지어냈는지)                                         |

**함께 드러난 것 (범위 밖, 보고만):**

- (있으면 적는다. 없으면 "없음")
```

괄호 자리를 실제 출력으로 채운다. 실비는 세션 로그 프론트매터 `usd:` 를 더한다.

- [ ] **Step 6: 커밋**

```bash
npx prettier --write docs/superpowers/specs/2026-09-18-query-answer-grounding-design.md
git add docs/superpowers/specs/2026-09-18-query-answer-grounding-design.md
git commit -m "docs: B4 첫 실측 기록

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## 끝난 뒤

- 브랜치를 푸시하고 PR 링크만 준다. 본문은 사용자가 쓴다 (CLAUDE.md §2-9)
- A 에게 알릴 것은 설계 §7 한 줄이다 — 세션 출신 본문 절 `(AI)` 표시. PR 본문이 아니라 사용자가 전한다
