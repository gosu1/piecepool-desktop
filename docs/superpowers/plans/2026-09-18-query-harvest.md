# B3 세션 수확 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 고른 쿼리 세션의 대화 로그를 ingest 에 자료 하나로 넘겨 위키에 반영하고, 그 길이 유일하도록 전체 정리의 자동 흡수를 닫는다.

**Architecture:** A 가 준비해 둔 `ingestSource(v, { kind: "session", id, log }, { extraPaths })` 를 부르는 입구 둘(FROZEN `harvest()` · CLI)을 만든다. FROZEN 진입점은 한 줄 래퍼, 본체 `harvestLog()` 는 비동결이라 가짜 LLM 으로 테스트한다 (A 의 `sync.ts` 선례). `scanSources` 가 `.piecepool/sessions/` 를 훑던 루프를 지워 `npm run ingest` 가 세션을 건드리지 않게 한다. 설계: `docs/superpowers/specs/2026-09-18-query-harvest-design.md`.

**Tech Stack:** TypeScript (Node 22, `node --experimental-strip-types` 로 `.ts` 직접 실행) · vitest · isomorphic-git (테스트의 볼트 git). 새 패키지 없음.

## Global Constraints

- 브랜치 `feat/query-harvest` (B1 `feat/query-session` 위에 스택). `main` 에 직접 push 하지 않는다
- 커밋: Conventional Commits, 타입 영어 · 설명 한국어. 끝에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- FROZEN 시그니처를 바꾸지 않는다: `harvest(v, session, o?: { onProgress? })`, `ingest.run(...)`, `createTools(...)`
- `shared/` · `renderer/` · `main/` · `prompts/` 에 한 줄도 쓰지 않는다
- `ErrorKind` 에 새 값을 더하지 않는다 — 빈 로그는 `parse_failed`
- 공유 타입은 `src/shared/types.ts` 에서만 import 한다
- 커밋 전 `npx prettier --check . && npm run lint && npm run typecheck && npm test` 전부 통과
- 테스트 실행: `npx vitest run <파일>` (단일) · `npm test` (전체). 테스트는 실제 LLM 을 부르지 않는다
- 볼트 픽스처는 `mkdtemp` 임시 폴더에 만든다. 이 레포에 볼트를 커밋하지 않는다

## File Structure

| 파일                                                        | 책임                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/core/agent/tasks/query.ts`                             | `QuerySession.date` · `SessionMeta.date` · 로그 프론트매터 `date:` |
| `src/core/agent/tasks/query.test.ts`                        | `date:` 테스트                                                     |
| `src/core/agent/tasks/harvest.ts`                           | FROZEN `harvest()` 래퍼 + 비동결 본체 `harvestLog()`               |
| `src/core/agent/tasks/harvest.test.ts`                      | 신규 — 가짜 LLM 으로 본체 · 빈 로그 거부                           |
| `src/core/ingest/source.ts`                                 | `scanSources` 세션 루프 제거 (A 구역)                              |
| `src/core/ingest/engine.test.ts`                            | `scanSources` 가 세션을 돌려주지 않는다                            |
| `src/cli/harvest.ts`                                        | 신규 — `npm run harvest -- <볼트> <세션id>`                        |
| `src/cli/query.ts`                                          | `newSession()` 에 `date` · 대화 끝 `y/N`                           |
| `scripts/eval-query.ts`                                     | `QuerySession` 리터럴에 `date`                                     |
| `package.json`                                              | `"harvest"` 스크립트                                               |
| `docs/superpowers/specs/2026-09-06-repo-skeleton-design.md` | §15 이탈 표 한 줄                                                  |
| `docs/superpowers/specs/2026-09-17-query-session-design.md` | §11.2 "다음 PR" 두 건 해소 표시                                    |
| `CLAUDE.md`                                                 | §5 스텁 개수                                                       |

---

### Task 1: 세션 로그에 `date:` — 세션 시작 시 한 번

**Files:**

- Modify: `src/core/agent/tasks/query.ts` (`SessionMeta` · `QuerySession` · `buildSessionLog` · `ask`)
- Modify: `src/core/agent/tasks/query.test.ts`
- Modify: `src/cli/query.ts:6-14` (`newSession`)
- Modify: `scripts/eval-query.ts:36-41`

**Interfaces:**

- Produces: `QuerySession.date: string` (필수, `YYYY-MM-DD` 로컬 날짜) · `SessionMeta.date: string`. 로그 프론트매터에 `date: YYYY-MM-DD` 줄. Task 5 의 CLI 가 `session.date` 를 만든다
- 왜: `ask()` 가 매 턴 로그를 통째로 다시 쓰므로 쓸 때의 오늘로 찍으면 자정 넘긴 대화가 마지막 턴 날짜가 된다. ingest 의 `itemFromSource` 가 `^date:\s*(\d{4}-\d{2}-\d{2})` 로 이 줄을 읽어 출처 날짜로 쓴다 (없으면 수확한 날)

- [ ] **Step 1: 실패하는 테스트**

`src/core/agent/tasks/query.test.ts` 의 `const meta = {` 블록에 `date` 를 더하고, `describe("buildSessionLog", ...)` 안에 테스트를 추가한다.

```ts
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
  unsourced: 0,
};
```

```ts
it("세션 날짜를 date: 로 남긴다 — ingest 가 이것을 출처 날짜로 읽는다", () => {
  const md = buildSessionLog(meta, [{ who: "사용자", text: "질문" }]);
  expect(md).toContain("\ndate: 2026-09-18\n");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/agent/tasks/query.test.ts`
Expected: 새 테스트 1개 FAIL — `date:` 줄이 없다. (타입 오류로 파일 전체가 안 돌 수 있다 — `SessionMeta` 에 `date` 가 없어서. 그것도 실패다.)

- [ ] **Step 3: 구현**

`src/core/agent/tasks/query.ts`:

`SessionMeta` 에 필드 추가:

```ts
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
  unsourced: number;
}
```

`QuerySession` 에 필드 추가 (`id` 바로 아래):

```ts
export interface QuerySession {
  id: string;
  /** 세션을 시작한 날 `YYYY-MM-DD` (로컬). 만드는 쪽이 한 번 정한다 — 매 턴 다시 찍으면 자정을 넘긴 대화의 날짜가 바뀐다. */
  date: string;
  log: string;
```

`buildSessionLog` 의 `out.push(\`model: ${meta.model}\`);` 다음 줄에:

```ts
out.push(`date: ${meta.date}`);
```

`ask()` 의 `buildSessionLog(` 호출에서 `model:` 다음에:

```ts
      model: process.env.PIECEPOOL_LLM_MODEL ?? "kimi-k3",
      date: session.date,
      ...session.stats,
```

`src/cli/query.ts` — `localDate` 를 import 하고 `newSession` 에 `date` 를 더한다:

```ts
import { localDate } from "../core/ingest/wiki.ts";
```

```ts
function newSession(): QuerySession {
  // 콜론은 Windows 파일명에 쓸 수 없다 — 이 id 가 sessions/<id>.md 가 된다.
  const now = new Date();
  return {
    id: now.toISOString().replace(/[:.]/g, "-"),
    // id 는 UTC 라 날짜가 하루 어긋날 수 있다. 날짜는 로컬로 따로 정한다.
    date: localDate(now),
    log: "",
    turns: [],
    history: [],
  };
}
```

`scripts/eval-query.ts` 의 `QuerySession` 리터럴:

```ts
const session: QuerySession = {
  id: `eval-${Date.now()}`,
  date: localDate(new Date()),
  log: "",
  turns: [],
  history: [],
};
```

와 파일 머리에 `import { localDate } from "../src/core/ingest/wiki.ts";` (기존 import 들 옆에).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/core/agent/tasks/query.test.ts && npm run typecheck`
Expected: 테스트 7개 PASS · typecheck 오류 없음

- [ ] **Step 5: 커밋**

```bash
npx prettier --write src/core/agent/tasks/ src/cli/query.ts scripts/eval-query.ts
git add src/core/agent/tasks/query.ts src/core/agent/tasks/query.test.ts src/cli/query.ts scripts/eval-query.ts
git commit -m "feat: 세션 로그에 시작 날짜를 남긴다 — ingest 가 출처 날짜로 읽는다

매 턴 로그를 다시 쓰므로 날짜는 세션을 만들 때 한 번 정한다. id 는 UTC 라 거기서 뽑지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `harvest()` — FROZEN 래퍼 + 비동결 본체

**Files:**

- Modify: `src/core/agent/tasks/harvest.ts` (스텁 전체 교체, 첫 줄 마커 유지)
- Create: `src/core/agent/tasks/harvest.test.ts`

**Interfaces:**

- Consumes: `ingestSource(v, src, o)` from `src/core/ingest/sync.ts` · `EngineOptions` from `src/core/ingest/engine.ts` · `PiecePoolError` from `src/core/errors.ts` · `QuerySession` (Task 1 의 `date` 포함)
- Produces: `harvestLog(v: Vault, id: string, log: string, o?: EngineOptions): Promise<IngestResult>` — Task 4 의 CLI 가 이것을 직접 부른다. `harvest(v, session, o?)` — Task 5 의 CLI 가 부른다

- [ ] **Step 1: 실패하는 테스트**

`src/core/agent/tasks/harvest.test.ts` 신규. 헬퍼는 `ingest/engine.test.ts` 의 것을 옮겨 적는다 (export 되어 있지 않다).

```ts
// 수확 — 세션 로그가 자료 하나로 ingest 를 타서 커밋 하나가 된다.
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import type { Vault } from "../../../shared/types.ts";
import { repo } from "../../git/repo.ts";
import type { LlmPage } from "../../llm/chat.ts";
import type { Llm } from "../../ingest/engine.ts";
import { harvest, harvestLog } from "./harvest.ts";
import type { QuerySession } from "./query.ts";

async function tempVault(): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-harvest-"));
  await git.init({ ...repo({ root, agentWriteRoots: [] }) });
  return { root, agentWriteRoots: ["wiki", "sources", ".piecepool"] };
}

async function write(root: string, p: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, p)), { recursive: true });
  await writeFile(join(root, p), text, "utf8");
}

const read = (root: string, p: string) => readFile(join(root, p), "utf8");

/** 자료의 문장을 인용하는 페이지 한 장을 내는 가짜 AI. */
function fakeLlm(pages: LlmPage[]): Llm {
  return {
    async writeWiki() {
      return { pages };
    },
    async askJson<T>() {
      return { value: { summary: "달리기를 시작한 사람" } as T };
    },
  };
}

const LOG =
  "---\nid: s1\nmodel: kimi-k3\ndate: 2026-09-18\nturns: 2\ntool_calls: 1\nhit_cap: false\ntokens: { in: 1, cached: 0, out: 1 }\nunsourced: 0\n---\n\n## 1턴 (사용자)\n\n무릎이 아픈데 계속 뛰어도 될까?\n\n## 2턴 (AI)\n\n주당 10% 이상 늘리지 않는 것이 통설입니다.\n";

const PAGE: LlmPage = {
  name: "달리기",
  aliases_to_add: [],
  summary: "s",
  new_sections: [],
  replace_sections: [],
  new_records: [
    { fact: "주당 10% 이상 늘리지 않는다", quote: "주당 10% 이상 늘리지 않는 것이 통설입니다" },
  ],
};

describe("harvestLog", () => {
  it("세션 로그가 위키 · 출처 페이지 · 로그 자체와 함께 커밋 하나가 된다", async () => {
    const v = await tempVault();
    await write(v.root, ".piecepool/sessions/s1.md", LOG);

    const r = await harvestLog(v, "s1", LOG, { llm: fakeLlm([PAGE]) });

    expect(r.commitOid).not.toBe("");
    expect(r.written).toContain("wiki/달리기.md");
    expect(r.written).toContain("sources/@session-s1.md");
    expect(r.written).toContain(".piecepool/sessions/s1.md");
    expect(await read(v.root, "wiki/달리기.md")).toContain("← [[@session-s1#2턴 (AI)]] (AI)");
    // 로그의 date: 가 출처 날짜로 간다
    expect(await read(v.root, "sources/@session-s1.md")).toContain("date: 2026-09-18");
    expect(await git.listFiles({ ...repo(v), ref: "HEAD" })).toContain(".piecepool/sessions/s1.md");
  });

  it("같은 로그를 다시 수확하면 커밋하지 않는다 — 입력 벽 7", async () => {
    const v = await tempVault();
    await write(v.root, ".piecepool/sessions/s1.md", LOG);
    const llm = fakeLlm([PAGE]);
    await harvestLog(v, "s1", LOG, { llm });

    const again = await harvestLog(v, "s1", LOG, { llm });

    expect(again.commitOid).toBe("");
    expect(again.written).toEqual([]);
  });
});

describe("harvest", () => {
  it("빈 로그는 거부한다 — 반영할 대화가 없다", async () => {
    const v = await tempVault();
    const session: QuerySession = {
      id: "s0",
      date: "2026-09-18",
      log: "",
      turns: [],
      history: [],
    };
    await expect(harvest(v, session)).rejects.toMatchObject({ kind: "parse_failed" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/agent/tasks/harvest.test.ts`
Expected: FAIL — `harvestLog` 가 export 되지 않았다 / `harvest` 가 `unimplemented` 를 던진다

- [ ] **Step 3: 구현**

`src/core/agent/tasks/harvest.ts` 전체:

```ts
// FROZEN: harvest() 진입점 (0단계 설계 §8)
import type { OnProgress, Vault } from "../../../shared/types.ts";
import { PiecePoolError } from "../../errors.ts";
import type { EngineOptions } from "../../ingest/engine.ts";
import { ingestSource } from "../../ingest/sync.ts";
import type { IngestResult } from "./ingest.ts";
import type { QuerySession } from "./query.ts";

/**
 * 쿼리 세션을 하나의 자료로 보고 위키에 반영한다.
 * 사용자가 [위키에 반영] 을 누를 때만 일어난다 — 자동 반영하지 않는다.
 *
 * 쓰기 경로는 언제나 ingest 하나뿐이므로 여기서 ingest 를 재호출한다.
 * 세션 로그(.piecepool/sessions/<id>.md)는 툴이 아니라 ask() 가 쓰므로
 * extraPaths 로 넘겨 같은 커밋에 넣는다.
 */
export async function harvest(
  v: Vault,
  session: QuerySession,
  o?: { onProgress?: OnProgress },
): Promise<IngestResult> {
  if (!session.log) throw new PiecePoolError("parse_failed", "반영할 대화가 없다");
  return await harvestLog(v, session.id, session.log, o);
}

/**
 * harvest() 의 본체. 진입점은 동결이라 테스트용 가짜 AI(`llm`)를 받을 자리가 없어
 * 여기로 뺐다 — `ingest/sync.ts` 의 `ingestSource` 와 같은 이유다.
 * `npm run harvest` 도 파일에서 읽은 로그로 이것을 직접 부른다.
 */
export async function harvestLog(
  v: Vault,
  id: string,
  log: string,
  o: EngineOptions = {},
): Promise<IngestResult> {
  return await ingestSource(
    v,
    { kind: "session", id, log },
    { ...o, extraPaths: [`.piecepool/sessions/${id}.md`] },
  );
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/core/agent/tasks/harvest.test.ts && npm run lint`
Expected: 3개 PASS · lint 오류 없음 (import 경계 규칙 — `agent → ingest` 는 `ingest.ts` 가 이미 같은 방향으로 import 한다)

- [ ] **Step 5: 커밋**

```bash
npx prettier --write src/core/agent/tasks/harvest.ts src/core/agent/tasks/harvest.test.ts
git add src/core/agent/tasks/harvest.ts src/core/agent/tasks/harvest.test.ts
git commit -m "feat: harvest — 세션 로그를 자료 하나로 ingest 에 넘겨 커밋 하나로 반영한다

진입점은 동결이라 본체 harvestLog 를 빼서 가짜 AI 로 잰다 (ingest/sync.ts 와 같은 이유).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `scanSources` 의 세션 루프를 닫는다 — 수확만이 세션을 반영한다

**Files:**

- Modify: `src/core/ingest/source.ts:26-50` (`scanSources` 와 그 머리 주석)
- Modify: `src/core/ingest/engine.test.ts` (테스트 추가)

**Interfaces:**

- Consumes: `scanSources(v): Promise<SourceFile[]>` — 시그니처 그대로
- 왜: 전체 정리(`syncVault` · `countPending`)가 `.piecepool/sessions/` 를 원본처럼 흡수해 상위 §8.1 "수확은 사용자가 누를 때만" 과 어긋났다. 설계 §6. `SourceFile.session` 필드와 `itemFromSource` 의 session 분기는 그대로 둔다 — `harvest` 가 그 길로 들어간다

- [ ] **Step 1: 실패하는 테스트**

`src/core/ingest/engine.test.ts` 에 import 를 더하고 (`import { ingestSource, syncVault } from "./sync.ts";` 아래):

```ts
import { scanSources } from "./source.ts";
```

파일 끝에 describe 추가:

```ts
describe("scanSources", () => {
  it("세션 로그는 원본 목록에 넣지 않는다 — 세션은 사용자가 고를 때만 harvest 로 반영된다", async () => {
    const v = await tempVault();
    await write(v.root, "sources/메모.md", NOTE);
    await write(v.root, ".piecepool/sessions/s1.md", "## 1턴 (사용자)\n\n질문\n");

    const paths = (await scanSources(v)).map((s) => s.path);

    expect(paths).toEqual(["sources/메모.md"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/ingest/engine.test.ts -t "scanSources"`
Expected: FAIL — 배열에 `.piecepool/sessions/s1.md` 가 있다

- [ ] **Step 3: 구현**

`src/core/ingest/source.ts` 의 `scanSources` 머리 주석과 세션 루프를 고친다.

주석 (기존 두 줄 교체):

```ts
/**
 * `sources/` 안의 원본 파일. 출처 페이지(`@*.md`)와 숨김 파일은 뺀다.
 * 세션 로그(`.piecepool/sessions/`)는 여기서 훑지 않는다 — 사용자가 고른 세션만 `harvest` 가
 * 자료로 넘긴다 (상위 §8.1). 전체 정리가 세션을 흡수하면 안 고른 대화가 위키에 들어간다.
 */
```

루프 삭제 — 아래 다섯 줄을 지운다:

```ts
for (const e of await list(".piecepool/sessions")) {
  if (!e.isFile() || extname(e.name) !== ".md") continue;
  const id = basename(e.name, ".md");
  out.push({ path: `.piecepool/sessions/${e.name}`, name: `session-${id}`, session: true });
}
```

`list` 헬퍼는 `sources` 한 곳만 부르게 되지만 그대로 둔다 (readdir 실패를 빈 배열로 바꾸는 역할은 여전히 필요하다).

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/core/ingest && npm run lint && npm run typecheck`
Expected: 전부 PASS. `basename` · `extname` 이 다른 곳에서 안 쓰이면 lint 가 미사용 import 를 잡는다 — 그때만 그 import 를 지운다 (`sourceItem` 등이 쓰고 있으면 그대로)

- [ ] **Step 5: 커밋**

```bash
npx prettier --write src/core/ingest/source.ts src/core/ingest/engine.test.ts
git add src/core/ingest/source.ts src/core/ingest/engine.test.ts
git commit -m "fix: 전체 정리가 세션 로그를 흡수하지 않는다 — 세션은 사용자가 고를 때만 harvest 로

scanSources 가 .piecepool/sessions/ 를 원본처럼 훑어 npm run ingest 가 안 고른 대화까지
위키에 넣었다. 상위 §8.1 과 어긋난다. 실험 단계(de07048)의 배선이 이관 때 따라온 것.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `npm run harvest -- <볼트> <세션id>`

**Files:**

- Create: `src/cli/harvest.ts`
- Modify: `package.json:15-25` (`scripts`)

**Interfaces:**

- Consumes: `harvestLog(v, id, log, { onProgress })` (Task 2) · `openVault` · `log`/`main` from `src/cli/run.ts` · `PiecePoolError`
- 왜: 상위 §8.1 "반영하지 않은 로그는 남아 나중에 수확할 수 있다". `QuerySession` 을 가짜로 만들지 않는다 — 본체가 `id` · `log` 만 받는다

- [ ] **Step 1: 구현** (CLI 는 단위 테스트 없음 — `cli/ingest.ts` 와 같다. 검증은 Step 2 의 수동 실행)

`src/cli/harvest.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PiecePoolError } from "../core/errors.ts";
import { openVault } from "../core/vault/open.ts";
import { harvestLog } from "../core/agent/tasks/harvest.ts";
import { log, main } from "./run.ts";

// 키는 .env 에서: node --env-file=.env src/cli/harvest.ts <볼트> <세션id>
await main(async () => {
  const [vaultRoot, id] = process.argv.slice(2);
  if (!vaultRoot || !id) throw new Error("usage: npm run harvest -- <볼트경로> <세션id>");

  const v = await openVault(vaultRoot);
  const path = `.piecepool/sessions/${id}.md`;
  let text: string;
  try {
    text = await readFile(join(v.root, path), "utf8");
  } catch {
    throw new PiecePoolError("vault_not_found", `세션 로그가 없다: ${path}`);
  }

  const r = await harvestLog(v, id, text, { onProgress: log });
  console.log(
    r.commitOid ? `${r.written.length}건 반영됨 (${r.commitOid.slice(0, 8)})` : "이미 반영됨",
  );
});
```

`package.json` 의 `scripts` 에 `"query"` 다음 줄로:

```json
    "harvest": "node src/cli/harvest.ts",
```

- [ ] **Step 2: 수동 확인 (LLM 없이 되는 부분만)**

Run: `npm run harvest -- fixtures/vault-life 없는세션`
Expected: `[vault_not_found] 세션 로그가 없다: .piecepool/sessions/없는세션.md`, 종료 코드 1

Run: `npm run harvest`
Expected: `[unknown] usage: npm run harvest -- <볼트경로> <세션id>`

- [ ] **Step 3: 검증 스위트**

Run: `npx prettier --check . && npm run lint && npm run typecheck`
Expected: 전부 통과

- [ ] **Step 4: 커밋**

```bash
git add src/cli/harvest.ts package.json
git commit -m "feat: npm run harvest — 남겨 둔 세션 로그를 나중에 수확한다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: 대화 모드 끝에 `위키에 반영? [y/N]`

**Files:**

- Modify: `src/cli/query.ts:28-43` (대화 모드 블록)

**Interfaces:**

- Consumes: `harvest(v, session, { onProgress })` (Task 2) · `session.stats?.unsourced` (B1 의 `SessionStats`)
- 왜: 설계 §5. 단발 질문 모드는 묻지 않는다. `근거 없는 문단 N개` 는 반영 여부를 판단할 정보다

- [ ] **Step 1: 구현**

`src/cli/query.ts` 에 import 추가:

```ts
import { harvest } from "../core/agent/tasks/harvest.ts";
```

대화 모드 블록을 이렇게 바꾼다 (`const rl = createInterface(...)` 부터 파일 끝까지):

```ts
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const line = (await rl.question("> ")).trim();
      if (!line) break;
      console.log("\n" + (await ask(v, session, line, { onProgress: log })) + "\n");
    }
    // 수확은 사용자가 고를 때만 (상위 §8.1). 턴이 없으면 로그도 없다.
    if (session.turns.length) {
      const unsourced = session.stats?.unsourced ?? 0;
      console.log(`세션 로그: .piecepool/sessions/${session.id}.md · 근거 없는 문단 ${unsourced}개`);
      const yes = (await rl.question("위키에 반영? [y/N] ")).trim().toLowerCase() === "y";
      if (yes) {
        const r = await harvest(v, session, { onProgress: log });
        console.log(
          r.commitOid
            ? `${r.written.length}건 반영됨 (${r.commitOid.slice(0, 8)})`
            : "이미 반영됨",
        );
      }
    }
  } finally {
    rl.close();
  }
});
```

(기존의 마지막 `console.log(\`세션 로그: ...\`)` 줄은 위 블록 안으로 들어갔으므로 지운다.)

- [ ] **Step 2: 검증 스위트**

Run: `npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과

- [ ] **Step 3: 커밋**

```bash
git add src/cli/query.ts
git commit -m "feat: 대화가 끝나면 위키에 반영할지 묻는다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: 문서 — 이탈 기록 · 해소 표시 · 스텁 개수

**Files:**

- Modify: `docs/superpowers/specs/2026-09-06-repo-skeleton-design.md` §15 표 (마지막 행 뒤)
- Modify: `docs/superpowers/specs/2026-09-17-query-session-design.md` §11.2 표
- Modify: `CLAUDE.md:163`

- [ ] **Step 1: 0단계 §15 이탈 표에 한 줄**

`| 파서 타입 | ... |` 행 다음에:

```markdown
| 세션 자동 반영 | 상위 §8.1 사람이 누를 때만 | 코드가 전체 정리로 흡수 → §8.1 대로 닫음 | B3 설계 §6 — 실험 배선(de07048)이 이관 때 따라온 것 |
```

- [ ] **Step 2: B1 설계 §11.2 표의 두 행을 해소로**

```markdown
| **프론트매터 계기의 누계화** | **해소 (2026-09-18, B3 브랜치)** — `SessionStats` · `accumulate()` |
| **`scanVault` 이중 실행 제거** | **해소 (2026-09-18, B3 브랜치)** — `createTools` 옵션 `index?` |
```

(아래 본문 단락 "프론트매터 계기의 누계화." · "`scanVault` 이중 실행." 은 근거 기록이므로 그대로 둔다.)

- [ ] **Step 3: CLAUDE.md §5 스텁 개수**

`src/core` 의 `unimplemented:` 는 Task 2 뒤 13곳이다 (`grep -rc "unimplemented:" src/core | grep -v ":0"` 로 세어 확인한다). 163행을:

```markdown
**버그가 아니다.** `src/core` 는 아직 13곳이 이 상태다 (`main` 3 · `preload` 0 · `cli` 0).
```

- [ ] **Step 4: prettier 와 커밋**

```bash
npx prettier --write docs/superpowers/specs/2026-09-06-repo-skeleton-design.md docs/superpowers/specs/2026-09-17-query-session-design.md CLAUDE.md
npx prettier --check .
git add docs/superpowers/specs/2026-09-06-repo-skeleton-design.md docs/superpowers/specs/2026-09-17-query-session-design.md CLAUDE.md
git commit -m "docs: 세션 자동 반영 이탈을 기록하고 B1 이 미룬 두 건을 해소로 표시한다

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: 통과 조건 — 실 LLM 실행 (사람이 함께)

**Files:** 없음. 실행과 관찰만.

이 태스크는 실비(K3 호출)가 들고 `.env` 키가 필요하다. **에이전트가 대신 돌리지 않는다** — 사용자에게 아래 순서를 요청하고 결과를 받는다 (CLAUDE.md §7). 설계 §7.2 의 2~6번이다.

- [ ] **Step 1: CI 스위트**

Run: `npm ci && npx prettier --check . && npm run lint && npm run typecheck && npm test`
Expected: 전부 통과, 테스트 수 ≥ 337 (333 + Task 1 의 1 + Task 2 의 3 + Task 3 의 1 = 338)

- [ ] **Step 2: 대화 → 수확** (사용자)

```bash
node --env-file=.env src/cli/query.ts fixtures/vault-life
> 달리기 무릎 아픈 거 어떻게 해?
> 어제 새 러닝화 샀어
>            ← 빈 줄
위키에 반영? [y/N] y
```

확인: `cd fixtures/vault-life && git show --stat HEAD` 에 `wiki/*.md` · `sources/@session-<id>.md` · `.piecepool/sessions/<id>.md` · `.piecepool/sync_state.json` 이 **한 커밋**에 있다. 출처 페이지의 날짜가 오늘(로컬)이다.

- [ ] **Step 3: 재수확 — 커밋 없음** (사용자)

```bash
node --env-file=.env src/cli/harvest.ts fixtures/vault-life <세션id>
```

Expected: `이미 반영됨`, `git log` 에 새 커밋 없음

- [ ] **Step 4: 이어서 한 턴 → 재수확 — 기록 교체** (사용자)

세션 이어하기는 B2 라 CLI 로는 못 한다. 대신 로그 파일 끝에 턴을 손으로 덧붙여 해시를 바꾼다:

```markdown
## 3턴 (사용자)

러닝화는 아식스로 샀어
```

`npm run harvest -- fixtures/vault-life <세션id>` → 커밋 1개. `git show HEAD -- wiki/` 에서 이전 세션 출신 기록 줄(`← [[@session-<id>#…]]`)이 걷혔다가 다시 쓰인 것을 본다.

- [ ] **Step 5: 전체 정리가 세션을 안 건드린다** (사용자)

새 세션을 하나 더 만들되 `N` 으로 끝낸다. 그 다음 `node --env-file=.env src/cli/ingest.ts fixtures/vault-life` → 진행 로그에 `session-` 항목이 없고, 그 세션의 `sources/@session-*.md` 가 생기지 않는다.

- [ ] **Step 6: 옵시디언 확인 + ③ 세기** (사용자)

볼트를 옵시디언으로 열어 기록 줄이 맞는 페이지에 붙었는지, `(AI)` 가 AI 턴 것에만 붙었는지 본다. **수확된 `(AI)` 기록 줄 중 위키에 없던 내용이 몇 개인지** 센다 — 설계 §7.3 의 측정이고 ③ 거르기를 정할 첫 숫자다. 설계문서 §7.3 아래에 결과를 한 줄 적어 커밋한다.

- [ ] **Step 7: PR**

B1 (#11) 이 머지됐으면 `git rebase main` 후 push. 아직이면 base 를 `feat/query-session` 으로 PR 을 연다. 본문은 사용자가 쓴다 — 에이전트는 링크만 준다 (CLAUDE.md §2.9). 본문 재료: A 구역 변경(Task 3) 한 건, 0단계 §15 이탈 한 줄, 실측 결과(Step 6).
