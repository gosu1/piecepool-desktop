# 탭과 위키 읽기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트리에서 파일을 누르면 탭이 열리고 그 글이 보인다.

**Architecture:** renderer 가 처음으로 경로를 main 에 보낸다. 그래서 `resolveInVault`(FROZEN 스텁, 경로 방어의 단일 지점)를 채우고 main 이 열린 `Vault` 를 쥔다. `core/vault/notes.readRaw` 가 그 검증을 통과한 뒤 원문 문자열을 돌려주고, renderer 가 프론트매터만 잘라 그대로 보여 준다. 탭은 `NotePath` 를 키로 스토어가 들고, 각 탭이 자기 원문을 쥔다.

**Tech Stack:** Electron 44 · React · zustand · Tailwind v4 · vite · vitest (node)

**설계문서:** `docs/superpowers/specs/2026-09-15-tabs-and-wiki-read-design.md`

## Global Constraints

모든 태스크에 적용된다.

- **`.ts`/`.tsx` 확장자를 import 에 반드시 붙인다.** `node` 가 `.ts` 를 직접 실행하므로 확장자를 추론하지 않는다
- **`enum`·`namespace`·생성자 파라미터 프로퍼티 금지** (lint 가 잡는다)
- **`src/shared/types.ts` 는 FROZEN.** 읽고 import 만 한다. **한 줄도 고치지 않는다**
- **FROZEN 파일 셋을 이 계획이 건드린다. 합의된 범위는 정확히 이것뿐이다:**
  - `src/shared/ipc.ts` — `CHANNEL.noteRead` 하나 + `PiecePoolApi.readRaw` 하나 **추가** (Task 2)
  - `src/core/vault/notes.ts` — `readRaw` export 하나 **추가** (Task 2)
  - `src/core/vault/paths.ts` — `resolveInVault` **스텁 본문만** 채운다. 시그니처는 그대로 (Task 1)
  - **기존 시그니처를 하나도 바꾸지 않는다.** 바꿔야 할 것 같으면 멈추고 묻는다
  - `assertAgentWritable` 은 **채우지 않는다.** 이 계획에 쓰기가 없다
- **`src/core/` 는 `electron` 을 import 할 수 없다** (lint 가 잡는다)
- **`src/renderer/` 는 `core/`·`main/`·`cli/` 를 import 할 수 없다** (lint 가 잡는다). `shared/` 는 가능하다
- **`src/shared/` 는 `node:*`·`electron`·`window`·`document` 를 쓸 수 없다.** 타입과 순수 상수만
- **요청하지 않은 `unimplemented` 스텁을 채우지 않는다.** `readNote`·`writeNote`·`frontmatter.parse`·`main/keys.ts` 는 그대로 둔다
- **DOM 테스트를 만들지 않는다.** `vitest.config.ts` 는 `environment: "node"`, `include: ["src/**/*.test.ts"]` 다. 화면은 사람이 본다
- **테스트는 31개 / 5파일에서 시작한다.** 이 계획은 테스트를 **늘린다** — 태스크별 증가분이 각 태스크에 적혀 있다
- **매 커밋 전 `npx prettier --write .` 을 돌린다.** CI 가 `--check` 로 돈다
- **커밋 메시지**는 Conventional Commits, 타입은 영어 설명은 한국어. 끝에 두 줄을 **문자 그대로** 붙인다

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012JaHYUbJEzRicYDA3Z6HTS
  ```

- **브랜치는 `feat/electron-shell`.** `main` 에 직접 커밋하지 않는다
- **앱을 띄워 확인하는 절차**(Task 4 에만 있다):
  1. `tasklist | grep -ci electron.exe` 가 0인지 확인한다. **0이 아니면 죽이지 말고 멈춰서 보고하라** — 사용자가 앱을 열어 두고 있을 수 있다
  2. `npm start` 하나면 된다. dev 서버까지 함께 뜬다(`scripts/dev.mjs`)
  3. `tasklist | grep -ci electron.exe` 가 **4 근처**인지 확인한다
  4. 출력에서 `Unable to load preload script` 를 grep 한다. **나오면 실패다**
  5. 끝나면 0으로 되돌린다. `netstat -ano | grep ':5173 '` 로 LISTENING 잔여를 확인하고, 남았으면 그 PID 만 죽인다

## 파일 구조

| 파일                                   | 책임                                       | 태스크 |
| -------------------------------------- | ------------------------------------------ | ------ |
| `src/core/vault/paths.ts`              | 경로 방어의 단일 지점 (`resolveInVault`)   | 1      |
| `src/core/vault/paths.test.ts` (신규)  | 볼트 탈출 시도를 못 박는다                 | 1      |
| `src/core/vault/notes.ts`              | `readRaw` — 검증을 통과한 뒤 원문을 읽는다 | 2      |
| `src/core/vault/notes.test.ts` (신규)  | `readRaw` 가 검증을 실제로 거치는지        | 2      |
| `src/shared/ipc.ts`                    | `note:read` 채널과 `readRaw` 계약          | 2      |
| `src/preload/index.ts`                 | 화이트리스트에 `readRaw` 추가              | 2      |
| `src/main/ipc.ts`                      | 열린 `Vault` 보관 + `note:read` 핸들러     | 2      |
| `src/renderer/store/workspace.ts`      | 탭 모델 · 프론트매터 자르기                | 3      |
| `src/renderer/store/workspace.test.ts` | 탭 전이와 자르기 경계                      | 3      |
| `src/renderer/app/TabStrip.tsx` (신규) | 탭 줄                                      | 4      |
| `src/renderer/app/NoteView.tsx` (신규) | 활성 탭의 본문                             | 4      |
| `src/renderer/app/Shell.tsx`           | 탭 줄과 본문 배치                          | 4      |
| `src/renderer/app/FileTree.tsx`        | 클릭이 탭을 연다                           | 4      |

**태스크 순서의 이유:** 경로 방어(Task 1)를 맨 앞에 둔다. 이 조각에서 **유일하게 틀려도 화면에 표시가 없는 부분**이고, 뒤의 모든 읽기가 그 위에 선다. 화면(Task 4)을 마지막에 두면 그 앞까지는 전부 `environment: "node"` 로 검증된다.

## 이 계획이 하지 않는 것

- `readNote`·`writeNote`·`frontmatter.parse` 구현 — 설계 §2.1
- `assertAgentWritable` 구현 — 쓰기가 없다
- 마크다운 렌더 · CodeMirror · `[[링크]]` 클릭 · 파일 감시
- 탭 재정렬 · dirty 표시 · 오버플로 드롭다운 · 재시작 시 탭 복원

---

### Task 1: 경로 방어

이 조각에서 **유일하게 사람 눈으로 못 잡는 부분**이다. 테스트가 통과 조건이다.

**Files:**

- Modify: `src/core/vault/paths.ts` (`resolveInVault` 스텁 → 구현. 시그니처와 주석은 그대로)
- Create: `src/core/vault/paths.test.ts`

**Interfaces:**

- Consumes: `NotePath`·`Vault` (`src/shared/types.ts`, FROZEN — 읽기만), `PiecePoolError` (`src/core/errors.ts`)
- Produces: `resolveInVault(v, p): Promise<string>` — 검증을 통과한 **절대경로**를 돌려준다. 실패하면 `PiecePoolError("path_escape", ...)`

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`src/core/vault/paths.test.ts` 를 만든다.

```ts
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveInVault } from "./paths.ts";
import type { Vault } from "../../shared/types.ts";

/** 픽스처 볼트. wiki/a.md 하나가 들어 있다. */
async function fixture(): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-paths-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(join(root, "wiki", "a.md"), "# a", "utf8");
  return { root, agentWriteRoot: "wiki" };
}

describe("resolveInVault", () => {
  it("볼트 안 경로는 절대경로로 돌려준다", async () => {
    const v = await fixture();
    const got = await resolveInVault(v, "wiki/a.md");
    expect(got.endsWith(join("wiki", "a.md"))).toBe(true);
  });

  it("../ 로 볼트를 벗어나면 막는다", async () => {
    const v = await fixture();
    await expect(resolveInVault(v, "../secret.md")).rejects.toThrow();
  });

  it("중간에 낀 ../ 도 막는다", async () => {
    const v = await fixture();
    await expect(resolveInVault(v, "wiki/../../secret.md")).rejects.toThrow();
  });

  it("절대경로를 그대로 주면 막는다", async () => {
    const v = await fixture();
    const outside = resolve(v.root, "..", "secret.md");
    await expect(resolveInVault(v, outside)).rejects.toThrow();
  });

  it("루트 자신은 파일이 아니므로 막는다", async () => {
    const v = await fixture();
    await expect(resolveInVault(v, "")).rejects.toThrow();
  });

  it("막을 때 kind 가 path_escape 다", async () => {
    const v = await fixture();
    await expect(resolveInVault(v, "../secret.md")).rejects.toMatchObject({
      kind: "path_escape",
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/core/vault/paths.test.ts`
Expected: FAIL — 6개 전부 `unimplemented: core/vault/paths.resolveInVault` 로 죽는다

- [ ] **Step 3: `resolveInVault` 를 구현한다**

`src/core/vault/paths.ts` 의 import 줄을 다음으로 바꾼다. **첫 줄의 `// FROZEN:` 마커는 건드리지 않는다.**

```ts
// FROZEN: 파일 전체 — 경로 방어의 단일 지점 (0단계 설계 §8, 상위 §9)
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { NotePath, Vault } from "../../shared/types.ts";
import { PiecePoolError } from "../errors.ts";
```

그리고 `resolveInVault` 의 **본문만** 바꾼다. 위의 JSDoc 주석과 시그니처는 그대로 둔다.

```ts
export async function resolveInVault(v: Vault, p: NotePath): Promise<string> {
  // 루트부터 realpath 로 편다. macOS 의 /tmp → /private/tmp 처럼 루트 자체가
  // 심링크면, 편 대상과 안 편 루트를 비교하게 되어 정상 경로가 탈출로 보인다.
  const root = await realpath(v.root);

  // isAbsolute(p) 면 resolve 가 root 를 무시하고 p 를 그대로 돌려준다 —
  // 그래서 resolve 만으로는 막히지 않는다. 아래 contains 가 그것까지 잡는다.
  const abs = resolve(root, p);
  if (!contains(root, abs)) throw escape(p);

  // 여기까지는 문자열 계산이다. 심링크는 편 뒤에 다시 봐야 한다 —
  // 볼트 안의 link.md 가 볼트 밖을 가리키면 위 검사는 통과한다.
  const real = await realpath(abs);
  if (!contains(root, real)) throw escape(p);

  return real;
}

/** root 의 진짜 하위인가. root 자신은 파일이 아니므로 제외한다. */
function contains(root: string, target: string): boolean {
  const rel = relative(root, target);
  // "" 은 루트 자신, ".." 로 시작하면 바깥,
  // 절대경로면 다른 드라이브다(Windows 에서 relative 가 절대경로를 돌려준다).
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function escape(p: NotePath): PiecePoolError {
  return new PiecePoolError("path_escape", `볼트 밖 경로다: ${p}`);
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/core/vault/paths.test.ts`
Expected: PASS — 6개

`../secret.md` 테스트가 `path_escape` 가 아니라 `ENOENT` 로 실패하면, `contains` 가 아니라 `realpath` 가 먼저 터진 것이다. 그때는 순서가 틀린 것이니 보고하라.

- [ ] **Step 5: 전체 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **37개 / 6파일** (31 + 6)

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 볼트 밖 경로 탈출을 막는다"
```

---

### Task 2: 원문 읽기와 IPC 배선

**Files:**

- Modify: `src/core/vault/notes.ts` (`readRaw` 추가. 기존 스텁은 그대로)
- Create: `src/core/vault/notes.test.ts`
- Modify: `src/shared/ipc.ts` (FROZEN — 합의된 범위만)
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`

**Interfaces:**

- Consumes: `resolveInVault` (Task 1), 기존 `CHANNEL`·`PiecePoolApi`·`wrap()`·`open()`
- Produces:
  - `core/vault/notes.readRaw(v, p): Promise<string>`
  - `CHANNEL.noteRead = "note:read"`
  - `PiecePoolApi.readRaw(path: NotePath): Promise<Result<string>>`

- [ ] **Step 1: `readRaw` 테스트를 먼저 쓴다**

`src/core/vault/notes.test.ts` 를 만든다.

```ts
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRaw } from "./notes.ts";
import type { Vault } from "../../shared/types.ts";

async function fixture(body: string): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-notes-"));
  await mkdir(join(root, "wiki"), { recursive: true });
  await writeFile(join(root, "wiki", "a.md"), body, "utf8");
  return { root, agentWriteRoot: "wiki" };
}

describe("readRaw", () => {
  it("파일을 글자 그대로 돌려준다", async () => {
    const v = await fixture("---\ncreated: 2025-10-03\n---\n\n# 러닝\n");
    expect(await readRaw(v, "wiki/a.md")).toBe("---\ncreated: 2025-10-03\n---\n\n# 러닝\n");
  });

  it("볼트 밖 경로는 읽지 않는다", async () => {
    const v = await fixture("# a");
    await expect(readRaw(v, "../secret.md")).rejects.toMatchObject({ kind: "path_escape" });
  });

  it("없는 파일은 실패한다", async () => {
    const v = await fixture("# a");
    await expect(readRaw(v, "wiki/없다.md")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/core/vault/notes.test.ts`
Expected: FAIL — `readRaw` 가 없어서 import 가 깨진다

- [ ] **Step 3: `readRaw` 를 더한다**

`src/core/vault/notes.ts` 의 import 를 다음으로 바꾼다. **첫 줄 두 개의 주석은 건드리지 않는다.**

```ts
// FROZEN: retitleNote 를 뺀 전체 (0단계 설계 §8)
// retitleNote 는 가배치 5단계.
import { readFile } from "node:fs/promises";
import type { Note, NotePath, Vault } from "../../shared/types.ts";
import { resolveInVault } from "./paths.ts";
```

그리고 `readNote` 스텁 **앞**에 `readRaw` 를 넣는다. 기존 스텁은 하나도 고치지 않는다.

```ts
/**
 * 마크다운 원문을 글자 그대로 읽는다. 파싱하지 않는다.
 *
 * 화면과 에디터는 구조가 아니라 글자를 다룬다 — `readNote` 와 목적이 다르다.
 * 이 함수의 본체는 사실 `readFile` 이 아니라 `resolveInVault` 다.
 * 볼트 파일을 읽는 길이 이 문 하나만 남게 하는 것이 요점이다.
 */
export async function readRaw(v: Vault, p: NotePath): Promise<string> {
  return readFile(await resolveInVault(v, p), "utf8");
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/core/vault/notes.test.ts`
Expected: PASS — 3개

- [ ] **Step 5: `src/shared/ipc.ts` 에 채널과 계약을 더한다**

`CHANNEL` 에 한 줄, `PiecePoolApi` 에 한 줄이다. 기존 줄과 `// FROZEN:` 마커는 건드리지 않는다.

```ts
export const CHANNEL = {
  vaultPick: "vault:pick",
  vaultLast: "vault:last",
  noteRead: "note:read",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggleMaximize",
  windowClose: "window:close",
} as const;
```

`PiecePoolApi` 의 `lastVault` 줄 다음에 넣는다.

```ts
/**
 * 노트 원문. **renderer 가 경로를 보내는 유일한 자리다** —
 * main 이 resolveInVault 로 검증한다. 이름이 core 의 readNote 와 다른 이유는
 * 돌려주는 것이 Note 가 아니라 문자열이기 때문이다.
 */
readRaw: (path: NotePath) => Promise<Result<string>>;
```

`NotePath` 는 이 파일이 이미 타입 import 하고 있다.

- [ ] **Step 6: preload 가 노출한다**

`src/preload/index.ts` 의 `api` 객체에서 `lastVault` 줄 다음에 한 줄을 넣는다.

```ts
    readRaw: (path) => ipcRenderer.invoke(CHANNEL.noteRead, path),
```

- [ ] **Step 7: main 이 열린 볼트를 쥐고 핸들러를 단다**

`src/main/ipc.ts` 의 import 에 `readRaw` 를 더한다.

```ts
import { readRaw } from "../core/vault/notes.ts";
```

`stateFile()` **앞**에 모듈 변수를 둔다.

```ts
/**
 * 지금 열려 있는 볼트. note:read 가 resolveInVault 에 넘길 v 다.
 * renderer 가 보낸 경로를 이것 없이 검증할 방법이 없다 — 재구축 설계 §3 이 지시한 자리다.
 */
let opened: Vault | null = null;
```

`Vault` 타입 import 를 더한다.

```ts
import type { AppError, ErrorKind, Result, Vault } from "../shared/types.ts";
```

`open()` 에서 `openVault` 결과를 담는다. **`writeLastVault` 의 위치는 그대로 둔다** — `readTree` 성공 뒤에 쓰는 순서가 앞 조각의 수정이다.

```ts
async function open(root: string): Promise<VaultPayload> {
  const v = await openVault(root);
  const payload = { root: v.root, name: basename(v.root), tree: await readTree(v) };
  await writeLastVault(stateFile(), v.root);
  opened = v;
  return payload;
}
```

`registerHandlers` 의 `vaultLast` 블록 **다음**, 창 조작 셋 **앞**에 핸들러를 넣는다.

```ts
ipcMain.handle(CHANNEL.noteRead, (_e, path: unknown) =>
  wrap(async () => {
    // renderer 가 보낸 값이다. 타입은 경계를 못 건너오므로 여기서 직접 본다.
    if (typeof path !== "string") {
      throw new PiecePoolError("path_escape", "경로가 문자열이 아니다");
    }
    if (opened === null) {
      throw new PiecePoolError("vault_not_found", "볼트가 열려 있지 않다");
    }
    return await readRaw(opened, path);
  }),
);
```

- [ ] **Step 8: 전체 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **40개 / 7파일** (37 + 3)

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: 노트 원문을 읽는 길을 연다"
```

---

### Task 3: 탭 모델과 프론트매터 자르기

화면이 없어도 전부 `environment: "node"` 로 검증된다.

**Files:**

- Modify: `src/renderer/store/workspace.ts`
- Modify: `src/renderer/store/workspace.test.ts`

**Interfaces:**

- Consumes: `NotePath` (`src/shared/types.ts`), `bridge` (`src/renderer/bridge.ts`)
- Produces:
  - `stripFrontmatter(raw: string): string` — export 한다(테스트가 직접 부른다)
  - 스토어에 `tabs: Tab[]` · `activeTab: NotePath | null` · `openTab(path, title)` · `closeTab(path)`
  - `interface Tab { path: NotePath; title: string; body: string | null; error: string | null }`

- [ ] **Step 1: 실패하는 테스트를 먼저 쓴다**

`src/renderer/store/workspace.test.ts` 의 **맨 끝에** 덧붙인다. 기존 테스트는 한 줄도 고치지 않는다.
파일 상단 import 에 `stripFrontmatter` 를 더한다.

```ts
describe("stripFrontmatter", () => {
  it("상단 --- 블록을 잘라낸다", () => {
    const raw = "---\ncreated: 2025-10-03\n---\n\n# 러닝\n";
    expect(stripFrontmatter(raw)).toBe("# 러닝\n");
  });

  it("--- 가 없으면 그대로 둔다", () => {
    expect(stripFrontmatter("# 러닝\n본문")).toBe("# 러닝\n본문");
  });

  it("첫 줄이 아닌 --- 는 건드리지 않는다", () => {
    const raw = "# 러닝\n\n---\n\n본문";
    expect(stripFrontmatter(raw)).toBe(raw);
  });

  it("닫히지 않은 --- 는 그대로 둔다", () => {
    const raw = "---\ncreated: 2025-10-03\n\n# 러닝";
    expect(stripFrontmatter(raw)).toBe(raw);
  });
});

describe("탭", () => {
  it("같은 경로를 두 번 열어도 탭이 하나다", () => {
    const { openTab } = useWorkspace.getState();
    openTab("wiki/a.md", "a");
    openTab("wiki/a.md", "a");
    const s = useWorkspace.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.activeTab).toBe("wiki/a.md");
  });

  it("활성인 가운데 탭을 닫으면 오른쪽 이웃이 활성이 된다", () => {
    const { openTab, closeTab } = useWorkspace.getState();
    openTab("wiki/a.md", "a");
    openTab("wiki/b.md", "b");
    openTab("wiki/c.md", "c");
    // b 를 다시 열어 활성으로 만든다. 활성 탭을 닫아야 이웃 이동이 일어난다.
    openTab("wiki/b.md", "b");
    closeTab("wiki/b.md");
    const s = useWorkspace.getState();
    expect(s.tabs.map((t) => t.path)).toEqual(["wiki/a.md", "wiki/c.md"]);
    expect(s.activeTab).toBe("wiki/c.md");
  });

  it("활성이 아닌 탭을 닫으면 활성이 그대로다", () => {
    const { openTab, closeTab } = useWorkspace.getState();
    openTab("wiki/a.md", "a");
    openTab("wiki/b.md", "b");
    closeTab("wiki/a.md");
    expect(useWorkspace.getState().activeTab).toBe("wiki/b.md");
  });

  it("마지막 탭을 닫으면 activeTab 이 null 이다", () => {
    const { openTab, closeTab } = useWorkspace.getState();
    openTab("wiki/a.md", "a");
    closeTab("wiki/a.md");
    const s = useWorkspace.getState();
    expect(s.tabs).toHaveLength(0);
    expect(s.activeTab).toBeNull();
  });
});
```

**주의:** 기존 `beforeEach` 가 스토어를 초기 상태로 되돌리는지 확인하라. `tabs`·`activeTab` 이 그 되돌림에 포함되지 않으면 테스트가 서로 오염된다 — 포함되게 고쳐야 하면 그 한 줄만 고치고 보고하라.

`openTab` 은 `bridge` 를 통해 IPC 를 부른다. 테스트 환경(`environment: "node"`)에는 `window` 가 없으므로 **`bridge` 가 `undefined` 로 떨어지고 본문은 에러가 된다.** 위 테스트는 `tabs`·`activeTab` 의 전이만 보므로 그래도 통과해야 한다. 통과하지 않으면 `openTab` 이 IPC 실패를 흡수하지 못하는 것이니 보고하라.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `npx vitest run src/renderer/store/workspace.test.ts`
Expected: FAIL — `stripFrontmatter` import 가 깨지고 `openTab` 이 없다

- [ ] **Step 3: `stripFrontmatter` 를 더한다**

`src/renderer/store/workspace.ts` 의 `clampWidth` **다음**에 넣는다.

```ts
/**
 * 상단 프론트매터 블록을 잘라낸다. YAML 을 이해하지 않는다 —
 * 첫 줄이 `---` 일 때 다음 `---` 줄까지만 버린다.
 *
 * hashes 같은 필드는 사용자가 쓴 글이 아니라 도구가 남긴 것이라 읽는 데 방해가 된다.
 * 닫히는 `---` 가 없으면 프론트매터가 아니므로 원문을 그대로 돌려준다.
 */
export function stripFrontmatter(raw: string): string {
  const lines = raw.split("\n");
  if (lines[0] !== "---") return raw;
  const end = lines.indexOf("---", 1);
  if (end === -1) return raw;
  // 닫는 --- 다음의 빈 줄들도 함께 버린다.
  let i = end + 1;
  while (lines[i] === "") i++;
  return lines.slice(i).join("\n");
}
```

- [ ] **Step 4: 탭 상태와 액션을 더한다**

`WorkspaceState` 에 넷을 더한다. 기존 필드는 그대로 둔다.

```ts
/** 열린 탭 하나. body 와 error 는 둘 중 하나만 채워진다. */
export interface Tab {
  path: NotePath;
  title: string;
  body: string | null;
  error: string | null;
}
```

```ts
interface WorkspaceState {
  // ... 기존 필드 그대로 ...
  tabs: Tab[];
  activeTab: NotePath | null;
  openTab: (path: NotePath, title: string) => Promise<void>;
  closeTab: (path: NotePath) => void;
}
```

`create` 호출의 초기값에 둘을 더한다.

```ts
  tabs: [],
  activeTab: null,
```

그리고 `loadLastVault` **다음**에 액션 둘을 넣는다.

```ts
  openTab: async (path, title) => {
    // 이미 열려 있으면 다시 읽지 않는다. 파일 감시가 없어 다시 읽어도
    // 최신이라는 보장이 없고, 보던 글이 갑자기 바뀌는 쪽이 더 나쁘다.
    if (get().tabs.some((t) => t.path === path)) {
      set({ activeTab: path, selected: path });
      return;
    }

    set((s) => ({
      tabs: [...s.tabs, { path, title, body: null, error: null }],
      activeTab: path,
      selected: path,
    }));

    let body: string | null = null;
    let error: string | null = null;
    try {
      const r = await window.piecepool.readRaw(path);
      if (r.ok) body = stripFrontmatter(r.value);
      else error = r.error.message;
    } catch (e) {
      // preload 가 없으면 여기로 온다. 탭은 열린 채 이유를 보여 준다.
      error = `앱 내부 연결이 끊겼다: ${String(e)}`;
    }

    set((s) => ({
      tabs: s.tabs.map((t) => (t.path === path ? { ...t, body, error } : t)),
    }));
  },

  closeTab: (path) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.path === path);
      if (idx === -1) return {};
      const tabs = s.tabs.filter((t) => t.path !== path);
      // 닫은 탭이 활성이었을 때만 옮긴다. 오른쪽 이웃, 없으면 왼쪽.
      const activeTab =
        s.activeTab === path ? (tabs[idx]?.path ?? tabs[idx - 1]?.path ?? null) : s.activeTab;
      return { tabs, activeTab };
    }),
```

`get` 을 쓰므로 `create` 의 인자를 `(set, get)` 으로 바꾼다.

```ts
export const useWorkspace = create<WorkspaceState>((set, get) => ({
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `npx vitest run src/renderer/store/workspace.test.ts`
Expected: PASS

- [ ] **Step 6: 전체 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **48개 / 7파일** (40 + 8)

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 스토어가 탭을 들고 프론트매터를 접는다"
```

---

### Task 4: 화면

**Files:**

- Create: `src/renderer/app/TabStrip.tsx`
- Create: `src/renderer/app/NoteView.tsx`
- Modify: `src/renderer/app/Shell.tsx`
- Modify: `src/renderer/app/FileTree.tsx`

**Interfaces:**

- Consumes: `tabs`·`activeTab`·`openTab`·`closeTab` (Task 3)
- Produces: `TabStrip()` · `NoteView()` — 둘 다 props 없음

- [ ] **Step 1: `src/renderer/app/TabStrip.tsx` 생성**

**드래그 띠 주의:** 탭은 상단 32px 안에 들어간다. 탭과 ✕ 버튼에 `app-no-drag` 와 `relative z-10` 이 **둘 다** 없으면 보이는데 안 눌린다. 콘솔 경고도 렌더 예외도 없다.

```tsx
import { useWorkspace } from "../store/workspace.ts";

/**
 * 본문 영역 위의 탭 줄. 오른쪽 빈 공간은 일부러 비워 둔다 —
 * 거기가 창을 끄는 자리다(app-no-drag 를 붙이지 않는다).
 */
export function TabStrip() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTab = useWorkspace((s) => s.activeTab);
  const openTab = useWorkspace((s) => s.openTab);
  const closeTab = useWorkspace((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div className="flex h-8 shrink-0 items-stretch border-b border-hairline bg-chrome">
      {tabs.map((t) => {
        const active = t.path === activeTab;
        return (
          <div
            key={t.path}
            className={`app-no-drag relative z-10 flex min-w-0 max-w-[200px] items-center border-r border-hairline ${
              active ? "bg-canvas text-ink" : "text-ink-muted hover:bg-fill-subtle"
            }`}
          >
            <button
              type="button"
              onClick={() => void openTab(t.path, t.title)}
              aria-current={active ? "true" : undefined}
              className="min-w-0 flex-1 truncate px-3 text-left text-sm"
            >
              {t.title}
            </button>
            <button
              type="button"
              onClick={() => closeTab(t.path)}
              aria-label={`${t.title} 닫기`}
              className="grid h-8 w-7 shrink-0 place-items-center text-ink-faint hover:text-ink"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2">
                <path d="M1 1l6 6M7 1l-6 6" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: `src/renderer/app/NoteView.tsx` 생성**

```tsx
import { useWorkspace } from "../store/workspace.ts";

/** 활성 탭의 본문. 마크다운을 렌더하지 않는다 — 원문 그대로다(설계 §2). */
export function NoteView() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTab = useWorkspace((s) => s.activeTab);
  const tab = tabs.find((t) => t.path === activeTab) ?? null;

  if (tab === null) {
    return (
      <div className="grid flex-1 place-items-center text-sm text-ink-muted">열린 파일 없음</div>
    );
  }

  if (tab.error !== null) {
    return <div className="flex-1 overflow-auto p-4 text-sm text-danger">{tab.error}</div>;
  }

  if (tab.body === null) {
    return <div className="grid flex-1 place-items-center text-sm text-ink-muted">읽는 중…</div>;
  }

  return (
    <pre className="flex-1 overflow-auto whitespace-pre-wrap p-4 font-sans text-sm text-ink">
      {tab.body}
    </pre>
  );
}
```

- [ ] **Step 3: `Shell.tsx` 가 둘을 배치한다**

import 둘을 더한다.

```tsx
import { NoteView } from "./NoteView.tsx";
import { TabStrip } from "./TabStrip.tsx";
```

`<main>` 을 다음으로 바꾼다. 나머지 자식(띠·`WindowControls`·`Ribbon`·사이드바)은 그대로 둔다.
`selected` 를 더 이상 쓰지 않으므로 그 셀렉터 줄을 지운다.

```tsx
<main className="flex min-w-0 flex-1 flex-col">
  <TabStrip />
  <NoteView />
</main>
```

- [ ] **Step 4: `FileTree.tsx` 의 클릭이 탭을 연다**

`select` 셀렉터를 `openTab` 으로 바꾸고 `onClick` 을 바꾼다. 나머지는 그대로 둔다.

```tsx
const openTab = useWorkspace((s) => s.openTab);
```

```tsx
        onClick={() => (isDir ? toggleFolder(node.path) : void openTab(node.path, label))}
```

`label` 을 제목으로 넘긴다 — 트리에 보이는 이름과 탭 이름이 같아야 한다(`.md` 를 뗀 것).

- [ ] **Step 5: 전체 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **48개 / 7파일** 그대로 (이 태스크는 테스트를 늘리지 않는다)

`select` 가 아무 데서도 안 쓰이게 됐다면 **지우지 말고 보고하라** — 스토어의 공개 액션이라 다른 곳에서 쓸 수 있다.

- [ ] **Step 6: 앱을 띄워 확인한다**

Global Constraints 의 절차를 그대로 돌린다.
프로세스가 4 근처이고 `Unable to load preload script` 가 없으면 여기까지 통과다.

**화면의 클릭·드래그는 네가 판단할 수 없다.** 보고서에 **사람 확인 필요** 로 분리해 적는다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 트리를 누르면 탭이 열리고 글이 보인다"
```

---

## 통과 조건 (전체)

- `npx prettier --check .` · `npm run lint` · `npm run typecheck` · `npm test` 전부 통과
- 테스트 **48개 / 7파일** (31 → 48)
- main 출력에 `Unable to load preload script` 가 없다

**사람이 확인할 것** — 에이전트가 할 수 없다 (설계 §9):

- 트리에서 파일을 누르면 탭이 열리고 글이 보이나
- 같은 파일을 다시 누르면 새 탭이 생기지 않고 그 탭으로 가나
- ✕ 로 닫히나. 가운데 탭을 닫으면 이웃이 활성이 되나
- **탭이 눌리나** (설계 §6.1 — 실패하면 화면상 아무 표시가 없다)
- 탭 오른쪽 빈 곳을 잡아 창이 끌리나
- 프론트매터가 안 보이고 `# 제목` 부터 보이나

## 범위 밖

편집·저장 · 인박스 쓰기 · CodeMirror · 마크다운 렌더 · `[[링크]]` 클릭 · 파일 감시 ·
탭 재정렬 · dirty 표시 · 오버플로 드롭다운 · 재시작 시 탭 복원 · 검색 · 그래프 ·
`readNote`·`writeNote`·`frontmatter.parse`·`assertAgentWritable` 구현
