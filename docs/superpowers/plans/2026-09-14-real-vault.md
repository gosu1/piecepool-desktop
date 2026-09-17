# 실제 볼트 열기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 사용자가 폴더를 고르면 그 폴더의 실제 마크다운 트리가 사이드바에 뜬다.

**Architecture:** `renderer` 는 경로를 보내지 않는다 — "폴더를 골라 줘"와 "지금 볼트를 줘" 두 마디뿐이고 경로는 `main` 이 쥔다. `core` 가 디스크를 읽고, `main/ipc.ts` 가 `wrap()` 으로 `Result` 를 씌우고, `preload` 가 화이트리스트 둘만 열어 준다. 앞 조각이 모든 상태를 zustand 스토어 뒤에 둔 덕분에 컴포넌트는 거의 그대로다.

**Tech Stack:** Electron 44 · React · zustand · vite (renderer + preload lib 모드) · vitest (node)

**설계문서:** `docs/superpowers/specs/2026-09-14-real-vault-design.md`

## Global Constraints

모든 태스크에 적용된다.

- **`.ts`/`.tsx` 확장자를 import 에 반드시 붙인다.** `node` 가 `.ts` 를 직접 실행하므로 확장자를 추론하지 않는다
- **`enum`·`namespace`·생성자 파라미터 프로퍼티 금지.** type stripping 이 코드를 만들지 않으므로 죽는다 (lint 가 잡는다)
- **`src/shared/types.ts` 는 FROZEN.** 읽고 import 만 한다. **한 줄도 고치지 않는다**
- **`src/core/vault/paths.ts` 는 FROZEN.** 이번 계획에서 건드리지 않는다 — renderer 가 경로를 보내지 않으므로 검증할 입력이 없다
- **`src/core/` 는 `electron` 을 import 할 수 없다** (lint 가 잡는다). `dialog`·`app` 은 `main/` 에서만 쓴다
- **`src/renderer/` 는 `core/`·`main/`·`cli/` 를 import 할 수 없다** (lint 가 잡는다). `shared/` 는 가능하다
- **`src/shared/` 는 `node:*`·`electron`·`window`·`document` 를 쓸 수 없다.** 타입과 순수 상수만
- **요청하지 않은 `unimplemented` 스텁을 채우지 않는다**
- **DOM 테스트를 만들지 않는다.** `vitest.config.ts` 는 `environment: "node"`, `include: ["src/**/*.test.ts"]` 다. 화면은 사람이 본다 (CLAUDE.md §7)
- **매 커밋 전 `npx prettier --write .` 을 돌린다.** CI 가 `--check` 로 돈다
- **커밋 메시지**는 Conventional Commits, 타입은 영어 설명은 한국어. 끝에 두 줄을 **문자 그대로** 붙인다

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012JaHYUbJEzRicYDA3Z6HTS
  ```

- **브랜치는 `feat/electron-shell`.** `main` 에 직접 커밋하지 않는다
- 테스트 수는 시작 시점에 **12개(2파일)** 다. 태스크별 증가분이 각 태스크에 적혀 있다

---

### Task 1: IPC 계약

타입만 옮긴다. 동작은 하나도 바뀌지 않는다.

**Files:**

- Create: `src/shared/ipc.ts`
- Modify: `src/renderer/store/workspace.ts` (상단 타입 선언부)

**Interfaces:**

- Consumes: `NotePath`·`Result` (`src/shared/types.ts`, FROZEN — 읽기만)
- Produces:
  - `CHANNEL = { vaultPick: "vault:pick", vaultLast: "vault:last" } as const`
  - `interface TreeNode { name: string; path: NotePath; kind: "dir" | "file"; children?: TreeNode[] }`
  - `interface VaultPayload { root: string; name: string; tree: TreeNode[] }`
  - `interface PiecePoolApi { pickVault(): Promise<Result<VaultPayload | null>>; lastVault(): Promise<Result<VaultPayload | null>> }`
  - `src/renderer/store/workspace.ts` 가 `TreeNode` 를 **재수출**한다 (`FileTree.tsx` 의 기존 import 가 그대로 살아야 한다)

- [ ] **Step 1: `src/shared/ipc.ts` 생성**

```ts
// IPC 경계의 계약이다. main·preload·renderer 가 같은 문자열과 같은 모양을 쓰게 하는 유일한 출처다.
// shared 규칙 그대로 — 타입과 순수 상수만 둔다. node:* 도 electron 도 여기 없다.
import type { NotePath, Result } from "./types.ts";

/** 채널명. 문자열을 양쪽에 각각 적으면 오타가 런타임까지 간다. */
export const CHANNEL = {
  vaultPick: "vault:pick",
  vaultLast: "vault:last",
} as const;

/** 트리 한 칸. main 이 만들어 renderer 로 보낸다. */
export interface TreeNode {
  /** 파일명 그대로. `.md` 를 포함한다 — 떼는 것은 화면의 몫이다. */
  name: string;
  /** 볼트 루트 기준 상대경로. POSIX 구분자로 고정한다. */
  path: NotePath;
  kind: "dir" | "file";
  children?: TreeNode[];
}

/** 볼트를 열면 트리는 항상 필요하다. 두 번 왕복할 이유가 없어 함께 싣는다. */
export interface VaultPayload {
  /** 절대경로. */
  root: string;
  /** 폴더 이름. 사이드바 하단 전환기에 표시한다. */
  name: string;
  tree: TreeNode[];
}

/**
 * preload 가 renderer 에 열어 주는 전부다.
 * 여기 없는 것은 화면에서 부를 수 없다 — 이 인터페이스가 곧 공격 표면의 목록이다.
 */
export interface PiecePoolApi {
  pickVault: () => Promise<Result<VaultPayload | null>>;
  lastVault: () => Promise<Result<VaultPayload | null>>;
}
```

- [ ] **Step 2: 스토어가 `TreeNode` 를 재수출하게 한다**

`src/renderer/store/workspace.ts` 의 맨 위 import 두 줄과 지역 `TreeNode` 선언을 다음으로 교체한다.

바꾸기 전:

```ts
import { create } from "zustand";
import type { NotePath } from "../../shared/types.ts";

export interface TreeNode {
  name: string;
  path: NotePath;
  kind: "dir" | "file";
  children?: TreeNode[];
}
```

바꾼 뒤:

```ts
import { create } from "zustand";
import type { NotePath } from "../../shared/types.ts";
import type { TreeNode } from "../../shared/ipc.ts";

// FileTree.tsx 가 스토어에서 TreeNode 를 가져다 쓴다. 그 import 를 살려 둔다.
export type { TreeNode };
```

`verbatimModuleSyntax` 가 켜져 있으므로 `export type { ... }` 형태를 지킨다. 파일의 나머지(`MOCK_TREE` 포함)는 이 태스크에서 손대지 않는다.

- [ ] **Step 3: 검증**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과. **테스트는 그대로 12개(2파일)** — 타입만 옮겼으므로 동작이 바뀌면 안 된다.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: IPC 계약을 shared/ipc.ts 에 둔다"
```

---

### Task 2: `openVault` (TDD)

**Files:**

- Modify: `src/core/vault/open.ts` (스텁 → 구현)
- Test: `src/core/vault/open.test.ts` (신규)

**Interfaces:**

- Consumes: `Vault` (`src/shared/types.ts`), `PiecePoolError` (`src/core/errors.ts`)
- Produces: `openVault(root: string): Promise<Vault>` — 시그니처는 스텁 그대로다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/core/vault/open.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openVault } from "./open.ts";
import { PiecePoolError } from "../errors.ts";

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "pp-open-"));
}

describe("openVault", () => {
  it("폴더에서 Vault 를 만든다", async () => {
    const root = await tempDir();
    const v = await openVault(root);
    expect(v.root).toBe(resolve(root));
    expect(v.agentWriteRoot).toBe("wiki");
  });

  it("없는 폴더는 vault_not_found 로 던진다", async () => {
    const missing = join(await tempDir(), "없는폴더");
    await expect(openVault(missing)).rejects.toBeInstanceOf(PiecePoolError);
    await expect(openVault(missing)).rejects.toMatchObject({ kind: "vault_not_found" });
  });

  it("폴더에 아무 자국도 남기지 않는다", async () => {
    // 구경하려고 연 폴더에 .git·.piecepool 이 생기면 안 된다 (설계 §2.1).
    const root = await tempDir();
    await openVault(root);
    expect(await readdir(root)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test`
Expected: FAIL — 3개가 `unimplemented: core/vault/open.openVault` 로 죽는다

- [ ] **Step 3: 구현한다**

`src/core/vault/open.ts` 전체를 교체한다.

```ts
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Vault } from "../../shared/types.ts";
import { PiecePoolError } from "../errors.ts";

/**
 * 볼트를 연다. 폴더가 있는지 확인하고 Vault 를 만든다.
 *
 * git init 과 .piecepool 정비는 **하지 않는다** — 구경하려고 연 폴더에 자국을
 * 남기지 않는다(2026-09-14 실제 볼트 설계 §2.1). 안전망이 실제로 필요해지는
 * 시점, 즉 에이전트가 처음 쓸 때 3단계에서 붙인다.
 */
export async function openVault(root: string): Promise<Vault> {
  const abs = resolve(root);

  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new PiecePoolError("vault_not_found", `폴더를 찾지 못했다: ${abs}`);
  }
  if (!info.isDirectory()) {
    throw new PiecePoolError("vault_not_found", `폴더가 아니다: ${abs}`);
  }

  return { root: abs, agentWriteRoot: "wiki" };
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test`
Expected: PASS — **16개(3파일)**

- [ ] **Step 5: 검증하고 커밋**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat: 볼트를 읽기 전용으로 연다"
```

---

### Task 3: 디스크 순회 (TDD)

**Files:**

- Create: `src/core/vault/tree.ts`
- Test: `src/core/vault/tree.test.ts`

**Interfaces:**

- Consumes: `Vault` (`src/shared/types.ts`), `TreeNode` (`src/shared/ipc.ts`, Task 1)
- Produces: `readTree(v: Vault): Promise<TreeNode[]>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/core/vault/tree.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTree } from "./tree.ts";
import type { Vault } from "../../shared/types.ts";

/** 픽스처 볼트를 만든다. dirs 는 폴더, files 는 빈 파일이다. */
async function fixture(dirs: string[], files: string[]): Promise<Vault> {
  const root = await mkdtemp(join(tmpdir(), "pp-tree-"));
  for (const d of dirs) await mkdir(join(root, d), { recursive: true });
  for (const f of files) await writeFile(join(root, f), "", "utf8");
  return { root, agentWriteRoot: "wiki" };
}

describe("readTree", () => {
  it("점으로 시작하는 폴더를 건너뛴다", async () => {
    const v = await fixture([".git", ".obsidian", "wiki"], [".git/HEAD"]);
    expect((await readTree(v)).map((n) => n.name)).toEqual(["wiki"]);
  });

  it("마크다운이 아닌 파일을 제외한다", async () => {
    const v = await fixture([], ["a.md", "b.pdf", "c.png"]);
    expect((await readTree(v)).map((n) => n.name)).toEqual(["a.md"]);
  });

  it("폴더를 파일보다 먼저 두고 각각 이름순으로 정렬한다", async () => {
    const v = await fixture(["zeta", "alpha"], ["z.md", "a.md"]);
    expect((await readTree(v)).map((n) => n.name)).toEqual(["alpha", "zeta", "a.md", "z.md"]);
  });

  it("중첩 폴더를 children 으로 담고 경로는 POSIX 구분자를 쓴다", async () => {
    const v = await fixture(["wiki/개념"], ["wiki/개념/트랜스포머.md"]);
    const tree = await readTree(v);
    const nested = tree[0].children?.[0].children?.[0];
    expect(nested?.path).toBe("wiki/개념/트랜스포머.md");
    expect(nested?.kind).toBe("file");
  });

  it("빈 폴더도 결과에 남긴다", async () => {
    const v = await fixture(["빈폴더"], []);
    const tree = await readTree(v);
    expect(tree.map((n) => n.name)).toEqual(["빈폴더"]);
    expect(tree[0].children).toEqual([]);
  });

  it("심볼릭 링크 폴더를 따라가지 않는다", async () => {
    const v = await fixture(["진짜"], ["진짜/x.md"]);
    try {
      await symlink(join(v.root, "진짜"), join(v.root, "링크"), "dir");
    } catch {
      // Windows 는 개발자 모드나 관리자 권한이 없으면 링크를 못 만든다.
      return;
    }
    expect((await readTree(v)).map((n) => n.name)).toEqual(["진짜"]);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./tree.ts"`

- [ ] **Step 3: 구현한다**

`src/core/vault/tree.ts`

```ts
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Vault } from "../../shared/types.ts";
import type { TreeNode } from "../../shared/ipc.ts";

/**
 * 볼트의 마크다운 트리를 읽는다.
 *
 * 실제 볼트가 .md 수십 장 규모이므로 열 때 한 번에 전부 읽는다.
 * 지연 로딩은 그 규모에 필요 없다(설계 §2).
 */
export async function readTree(v: Vault): Promise<TreeNode[]> {
  return await readDir(v.root, "");
}

async function readDir(absDir: string, relDir: string): Promise<TreeNode[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const e of entries) {
    // 심볼릭 링크는 볼트 밖으로 나가거나 순환할 수 있다 — 따라가지 않는다.
    if (e.isSymbolicLink()) continue;

    // 경로는 POSIX 구분자로 고정한다. NotePath 의 약속이다.
    const rel = relDir ? `${relDir}/${e.name}` : e.name;

    if (e.isDirectory()) {
      // .git · .obsidian · .piecepool — 사용자가 볼 것이 아니다.
      if (e.name.startsWith(".")) continue;
      dirs.push({
        name: e.name,
        path: rel,
        kind: "dir",
        children: await readDir(join(absDir, e.name), rel),
      });
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
      files.push({ name: e.name, path: rel, kind: "file" });
    }
  }

  const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, "ko");
  return [...dirs.sort(byName), ...files.sort(byName)];
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test`
Expected: PASS — **22개(4파일)**

- [ ] **Step 5: 검증하고 커밋**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat: 볼트의 마크다운 트리를 읽는다"
```

---

### Task 4: 마지막 볼트 기억 (TDD)

**Files:**

- Create: `src/main/recent.ts`
- Test: `src/main/recent.test.ts`

**Interfaces:**

- Consumes: 없음
- Produces:
  - `readLastVault(stateFile: string): Promise<string | null>`
  - `writeLastVault(stateFile: string, root: string): Promise<void>`

`app.getPath("userData")` 를 이 모듈 안에서 부르지 않고 **파일 경로를 인자로 받는 이유**: electron 없이 vitest 에서 그대로 돌리기 위해서다. 실제 경로는 `main/ipc.ts` 가 넘긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/main/recent.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastVault, writeLastVault } from "./recent.ts";

async function tempState(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "pp-recent-")), "state.json");
}

describe("recent", () => {
  it("쓴 경로를 그대로 다시 읽는다", async () => {
    const f = await tempState();
    await writeLastVault(f, "C:/볼트/second-brain");
    expect(await readLastVault(f)).toBe("C:/볼트/second-brain");
  });

  it("파일이 없으면 null 이다", async () => {
    expect(await readLastVault(await tempState())).toBeNull();
  });

  it("내용이 깨졌으면 null 이다", async () => {
    const f = await tempState();
    await writeLastVault(f, "C:/볼트/x");
    await writeFile(f, "{ 이건 JSON 이 아니다", "utf8");
    expect(await readLastVault(f)).toBeNull();
  });

  it("부모 폴더가 없어도 쓴다", async () => {
    const f = join(await mkdtemp(join(tmpdir(), "pp-recent-")), "깊은", "곳", "state.json");
    await writeLastVault(f, "C:/볼트/y");
    expect(await readLastVault(f)).toBe("C:/볼트/y");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./recent.ts"`

- [ ] **Step 3: 구현한다**

`src/main/recent.ts`

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * 마지막으로 연 볼트 경로. 앱이 디스크에 남기는 유일한 상태다(상위 §4.1).
 *
 * 경로를 인자로 받는다 — electron 의 app.getPath 를 여기서 부르면
 * vitest 에서 돌릴 수 없다. 실제 경로는 main/ipc.ts 가 넘긴다.
 */
export async function readLastVault(stateFile: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    const last = (parsed as { lastVault?: unknown }).lastVault;
    return typeof last === "string" ? last : null;
  } catch {
    // 파일이 없거나 깨졌으면 기억이 없는 것으로 본다. 기억은 편의일 뿐이다.
    return null;
  }
}

export async function writeLastVault(stateFile: string, root: string): Promise<void> {
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ lastVault: root }, null, 2), "utf8");
}
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test`
Expected: PASS — **27개(5파일)**

- [ ] **Step 5: 검증하고 커밋**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat: 마지막으로 연 볼트 경로를 기억한다"
```

---

### Task 5: preload 빌드 배선

preload 가 실제로 창에 붙는 데까지. 아직 부를 핸들러는 없다.

**Files:**

- Create: `vite.preload.config.ts`
- Modify: `src/preload/index.ts` (스텁 → 구현)
- Modify: `package.json` (스크립트 2개)
- Modify: `src/main/index.ts` (`join` import 복구 · `preload` 경로)

**Interfaces:**

- Consumes: `CHANNEL`·`PiecePoolApi`·`VaultPayload` (`src/shared/ipc.ts`, Task 1), `Result` (`src/shared/types.ts`)
- Produces: `out/preload/index.cjs` — 창이 로드하는 파일. `window.piecepool` 을 심는다

- [ ] **Step 1: `vite.preload.config.ts` 생성**

```ts
import { defineConfig } from "vite";

// preload 만 담당한다.
// 창이 sandbox: true(Electron 기본값)로 뜨므로 preload 는 ESM 을 쓸 수 없고
// 단일 CommonJS 파일이어야 한다 — main 의 type stripping 도 renderer 번들도
// 그 형식을 만들어 주지 않는다(설계 §2.2).
export default defineConfig({
  build: {
    outDir: "out/preload",
    emptyOutDir: true,
    lib: {
      entry: "src/preload/index.ts",
      formats: ["cjs"],
      fileName: () => "index.cjs",
    },
    // electron 은 런타임이 제공한다. 번들에 넣으면 안 된다.
    rollupOptions: { external: ["electron"] },
  },
});
```

- [ ] **Step 2: `src/preload/index.ts` 구현**

파일 전체를 교체한다. 기존 주석의 논지는 유지한다.

```ts
// OWNER: 7단계 — contextBridge 화이트리스트.
import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL } from "../shared/ipc.ts";
import type { PiecePoolApi } from "../shared/ipc.ts";

/**
 * 이 파일이 앱의 공격 표면 전체다.
 *
 * renderer 는 contextIsolation 으로 Node 접근이 차단돼 있고
 * 여기서 화이트리스트로 열어준 것만 쓸 수 있다.
 * fs 를 통째로 노출하면 격리가 무의미해진다 —
 * 경로 검증은 반드시 core/vault/paths.ts 에 둔다.
 *
 * 지금 열어 주는 것은 둘뿐이고, 둘 다 renderer 에서 경로를 받지 않는다.
 */
export function exposeApi(): void {
  const api: PiecePoolApi = {
    pickVault: () => ipcRenderer.invoke(CHANNEL.vaultPick),
    lastVault: () => ipcRenderer.invoke(CHANNEL.vaultLast),
  };
  contextBridge.exposeInMainWorld("piecepool", api);
}

exposeApi();
```

- [ ] **Step 3: `package.json` 스크립트**

`"dev": "vite",` 아래에 빌드 스크립트를 넣고 `start` 를 바꾼다.

```json
"build:preload": "vite build --config vite.preload.config.ts",
"start": "npm run build:preload && electron .",
```

`start` 에 묶는 이유: 사람이 칠 명령이 지금과 똑같이 유지된다.

- [ ] **Step 4: `src/main/index.ts` 가 preload 를 로드하게 한다**

`import { app, BrowserWindow, Menu, shell } from "electron";` 아래에 `join` import 를 되살린다 (앞 조각에서 고아가 되어 지웠던 그 import 다).

```ts
import { join } from "node:path";
```

그리고 `createWindow` 의 `webPreferences` 에 `preload` 를 더한다. 기존 두 줄과 주석은 그대로 둔다.

```ts
    webPreferences: {
      // "preload 화이트리스트가 공격 표면 전체" 라는 전제가 이 둘에 걸려 있다.
      // 껍데기 단계부터 켜 둔다 — 나중에 켜면 그 사이에 만든 UI 가 깨진다.
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(import.meta.dirname, "../../out/preload/index.cjs"),
    },
```

- [ ] **Step 5: 정적 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **27개** 그대로

- [ ] **Step 6: 번들이 CommonJS 인지 확인**

Run: `npm run build:preload`
그 다음:

```bash
head -3 out/preload/index.cjs
grep -c "^import " out/preload/index.cjs || true
```

Expected: `require("electron")` 같은 CJS 형태가 보이고, 최상위 `import ` 줄이 0개다. `import` 가 남아 있으면 샌드박스에서 로드에 실패한다.

- [ ] **Step 7: 창이 preload 를 실제로 읽는지 확인**

preload 로드 실패는 **main 프로세스 stderr 에 `Unable to load preload script` 로 찍힌다.** 이것이 이 태스크의 진짜 통과 조건이다.

1. `tasklist | grep -ci electron.exe` 가 0인지 확인하고, 아니면 먼저 죽인다
2. 터미널 A: `npm run dev` → `Local: http://localhost:5173/`
3. 터미널 B: `npm start` (백그라운드로 두고 출력을 파일에 남긴다)
4. `tasklist | grep -ci electron.exe` 가 **4 근처**인지 확인한다 (1이면 렌더러가 못 떴다)
5. main 출력에서 `Unable to load preload script` 를 찾는다. **나오면 실패다** — 보고하고 멈춘다
6. 둘 다 죽이고 0으로 돌아오는지 확인한다

관찰한 숫자와 문자열을 그대로 보고한다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: preload 를 단일 cjs 로 빌드해 창에 붙인다"
```

---

### Task 6: IPC 핸들러

**Files:**

- Modify: `src/main/ipc.ts` (`registerHandlers` 스텁 → 구현. `wrap`·`toAppError` 는 그대로 둔다)
- Modify: `src/main/index.ts` (`registerHandlers()` 호출)

**Interfaces:**

- Consumes: `CHANNEL`·`VaultPayload` (Task 1), `openVault` (Task 2), `readTree` (Task 3), `readLastVault`·`writeLastVault` (Task 4), 기존 `wrap()`
- Produces: `vault:pick` 과 `vault:last` 채널. 둘 다 `Result<VaultPayload | null>` 을 돌려준다

- [ ] **Step 1: `src/main/ipc.ts` 에 핸들러를 더한다**

파일 상단 import 를 다음으로 바꾼다. 기존 `wrap`·`toAppError` 본문은 **한 줄도 고치지 않는다.**

```ts
// OWNER: 7단계 — 채널명과 요청/응답 타입은 shared/ipc.ts 에 둔다.
import { app, dialog, ipcMain } from "electron";
import { basename, join } from "node:path";
import type { AppError, ErrorKind, Result } from "../shared/types.ts";
import type { VaultPayload } from "../shared/ipc.ts";
import { CHANNEL } from "../shared/ipc.ts";
import { PiecePoolError } from "../core/errors.ts";
import { openVault } from "../core/vault/open.ts";
import { readTree } from "../core/vault/tree.ts";
import { readLastVault, writeLastVault } from "./recent.ts";
```

그리고 파일 맨 아래 `registerHandlers` 스텁을 다음으로 교체한다.

```ts
/** 앱이 디스크에 남기는 유일한 상태. */
function stateFile(): string {
  return join(app.getPath("userData"), "state.json");
}

/** 볼트를 열고 트리까지 실어 보낸다. 열면 트리는 항상 필요하다. */
async function open(root: string): Promise<VaultPayload> {
  const v = await openVault(root);
  await writeLastVault(stateFile(), v.root);
  return { root: v.root, name: basename(v.root), tree: await readTree(v) };
}

/** onProgress = webContents.send. CLI 가 console.log 를 넘기던 자리다. */
export function registerHandlers(): void {
  ipcMain.handle(CHANNEL.vaultPick, () =>
    wrap(async () => {
      const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      return await open(picked.filePaths[0]);
    }),
  );

  ipcMain.handle(CHANNEL.vaultLast, () =>
    wrap(async () => {
      const last = await readLastVault(stateFile());
      if (last === null) return null;
      try {
        return await open(last);
      } catch {
        // 기억한 폴더가 사라졌으면 조용히 "볼트 없음" 으로 떨어진다.
        // 사용자가 지운 폴더를 에러로 들이밀 이유가 없다.
        return null;
      }
    }),
  );
}
```

설계 §3 은 열린 `Vault` 를 모듈 변수에 쥔다고 했지만 **두지 않는다.** 지금 그것을 읽는 곳이 없다 — 새로고침 채널을 뺐기 때문이다. 읽는 쪽이 생기는 조각에서 함께 만든다.

- [ ] **Step 2: `bootstrap` 이 핸들러를 등록하게 한다**

`src/main/index.ts` 에서 `Menu.setApplicationMenu(null);` 다음, `createWindow();` 앞에 한 줄을 넣고 import 를 더한다.

```ts
import { registerHandlers } from "./ipc.ts";
```

```ts
// 창이 뜨기 전에 등록한다 — 렌더러가 곧바로 lastVault 를 부른다.
registerHandlers();

createWindow();
```

- [ ] **Step 3: 검증**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **27개** 그대로.

특히 lint 가 `main → core` import 를 막지 않는지 확인한다. zones 에 `{ target: "./src/core", from: "./src/main" }` 은 있지만 그 반대는 없다 — `main` 이 `core` 를 부르는 것이 정상 방향이다.

- [ ] **Step 4: 앱이 여전히 뜨는지 확인**

Task 5 Step 7 의 절차를 그대로 반복한다. 아직 화면에서 부르는 코드가 없으므로 보이는 변화는 없다. `Unable to load preload script` 가 없고 프로세스가 4 근처면 통과다.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 볼트 선택과 재개방 IPC 핸들러를 단다"
```

---

### Task 7: 스토어를 실물에 연결

**Files:**

- Modify: `src/renderer/store/workspace.ts` (`MOCK_TREE` 제거, 볼트 상태와 액션 추가)
- Create: `src/renderer/piecepool.d.ts`
- Modify: `src/renderer/store/workspace.test.ts` (초기 상태 변화 반영)

**Interfaces:**

- Consumes: `PiecePoolApi`·`VaultPayload`·`TreeNode` (Task 1), `window.piecepool` (Task 5)
- Produces: 스토어에 `vault: VaultPayload | null` · `error: string | null` · `loading: boolean` 과 액션 `pickVault(): Promise<void>` · `loadLastVault(): Promise<void>`

- [ ] **Step 1: `window.piecepool` 타입을 선언한다**

`src/renderer/piecepool.d.ts`

```ts
import type { PiecePoolApi } from "../shared/ipc.ts";

declare global {
  interface Window {
    piecepool: PiecePoolApi;
  }
}

export {};
```

preload 파일을 직접 import 하지 않는 이유: `renderer` 빌드가 `electron` 타입을 끌어오게 된다. 계약은 `shared/ipc.ts` 에 있으므로 양쪽이 그것만 본다.

- [ ] **Step 2: `MOCK_TREE` 를 지우고 볼트 상태를 넣는다**

`src/renderer/store/workspace.ts` 에서 `MOCK_TREE` 상수 전체(주석 포함)를 지우고, import·타입·스토어를 다음으로 만든다. 상수 셋(`MIN_SIDEBAR_WIDTH`·`MAX_SIDEBAR_WIDTH`·`RIBBON_WIDTH`)과 `clampWidth` 는 그대로 둔다.

```ts
import { create } from "zustand";
import type { NotePath, Result } from "../../shared/types.ts";
import type { TreeNode, VaultPayload } from "../../shared/ipc.ts";

// FileTree.tsx 가 스토어에서 TreeNode 를 가져다 쓴다. 그 import 를 살려 둔다.
export type { TreeNode };
```

`WorkspaceState` 를 다음으로 교체한다.

```ts
interface WorkspaceState {
  /** 열린 볼트. 없으면 아직 폴더를 고르지 않은 것이다. */
  vault: VaultPayload | null;
  tree: TreeNode[];
  /** 읽기 실패 메시지. 빈 볼트와 읽기 실패는 다른 상태다. */
  error: string | null;
  loading: boolean;
  expanded: Set<NotePath>;
  selected: NotePath | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleFolder: (path: NotePath) => void;
  select: (path: NotePath) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;
  pickVault: () => Promise<void>;
  loadLastVault: () => Promise<void>;
}

/** 두 액션이 같은 응답 모양을 받는다. 해석을 한 곳에 둔다. */
function applied(r: Result<VaultPayload | null>): Partial<WorkspaceState> {
  if (!r.ok) return { error: r.error.message, loading: false };
  // null 은 취소이거나 기억된 볼트가 없는 것이다 — 둘 다 아무 일도 일어나지 않는다.
  if (r.value === null) return { loading: false };
  return {
    vault: r.value,
    tree: r.value.tree,
    expanded: new Set(),
    selected: null,
    error: null,
    loading: false,
  };
}
```

그리고 `create` 호출의 초기값과 새 액션을 다음으로 한다. 기존 네 액션의 본문은 **한 줄도 고치지 않는다.**

```ts
export const useWorkspace = create<WorkspaceState>((set) => ({
  vault: null,
  tree: [],
  error: null,
  loading: false,
  expanded: new Set(),
  selected: null,
  sidebarOpen: true,
  sidebarWidth: 240,

  toggleFolder: (path) =>
    set((s) => {
      // 새 Set 을 만든다. 그 자리에서 고치면 참조가 같아 리렌더가 안 걸린다.
      const next = new Set(s.expanded);
      if (!next.delete(path)) next.add(path);
      return { expanded: next };
    }),

  select: (path) => set({ selected: path }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (px) => set({ sidebarWidth: clampWidth(px) }),

  pickVault: async () => {
    set({ loading: true, error: null });
    set(applied(await window.piecepool.pickVault()));
  },

  loadLastVault: async () => {
    set({ loading: true, error: null });
    set(applied(await window.piecepool.lastVault()));
  },
}));
```

- [ ] **Step 3: 테스트의 초기 상태 기대를 맞춘다**

`src/renderer/store/workspace.test.ts` 는 `beforeEach` 에서 `expanded: new Set(initial.expanded)` 로 되돌린다. 초기 `expanded` 가 `new Set(["wiki"])` 에서 빈 `Set` 으로 바뀌었지만, 테스트는 `"inbox"` 를 토글할 뿐이므로 **수정할 곳이 없다.**

실제로 그런지 확인한다.

Run: `npm test`
Expected: PASS — **27개** 그대로. 실패하면 그 테스트가 목 데이터에 기대고 있었다는 뜻이니, 무엇이 깨졌는지 보고한다.

- [ ] **Step 4: 검증하고 커밋**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat: 스토어가 목 대신 IPC 로 볼트를 받는다"
```

---

### Task 8: 화면

**Files:**

- Create: `src/renderer/app/VaultSwitcher.tsx`
- Modify: `src/renderer/app/Sidebar.tsx`
- Modify: `src/renderer/app/FileTree.tsx` (표시 이름에서 `.md` 제거)
- Modify: `src/renderer/app/Shell.tsx` (마운트 시 `loadLastVault`)
- Modify: `src/renderer/styles/tokens.css` (`danger` 토큰 추가)

**Interfaces:**

- Consumes: 스토어의 `vault`·`error`·`loading`·`pickVault`·`loadLastVault` (Task 7)
- Produces: `VaultSwitcher()` — props 없음

- [ ] **Step 1: `danger` 토큰을 더한다**

`src/renderer/styles/tokens.css` 의 `@theme inline` 블록에서 `--color-fill-subtle` 줄 다음에 한 줄, `:root` 블록에서 `--ds-fill-subtle` 줄 다음에 한 줄을 넣는다.

```css
--color-danger: var(--ds-danger);
```

```css
--ds-danger: #eb6f6b;
```

읽기 실패를 본문 색으로 그리면 그냥 텍스트로 보인다. 에러는 에러로 보여야 한다.

- [ ] **Step 2: `src/renderer/app/VaultSwitcher.tsx` 생성**

```tsx
import { useWorkspace } from "../store/workspace.ts";

/**
 * 사이드바 하단 고정. 옵시디언의 볼트 전환기 자리다.
 * 볼트가 없을 때도 같은 자리에서 같은 동작을 한다 — 진입점을 둘로 나누지 않는다.
 */
export function VaultSwitcher() {
  const vault = useWorkspace((s) => s.vault);
  const loading = useWorkspace((s) => s.loading);
  const pickVault = useWorkspace((s) => s.pickVault);

  return (
    <button
      type="button"
      onClick={() => void pickVault()}
      disabled={loading}
      aria-label={vault ? `볼트 바꾸기 (현재 ${vault.name})` : "폴더 열기"}
      className="flex h-9 shrink-0 items-center gap-2 border-t border-hairline px-3 text-left text-sm text-ink-2 hover:bg-fill-subtle disabled:opacity-60"
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        className="shrink-0 text-ink-faint"
      >
        <path d="M3 4.5 6 1.5 9 4.5M3 7.5 6 10.5 9 7.5" />
      </svg>
      <span className="truncate">{vault ? vault.name : "폴더 열기"}</span>
    </button>
  );
}
```

- [ ] **Step 3: `Sidebar.tsx` 가 세 상태를 그리게 한다**

파일 전체를 교체한다.

```tsx
import { FileTree } from "./FileTree.tsx";
import { VaultSwitcher } from "./VaultSwitcher.tsx";
import { useWorkspace } from "../store/workspace.ts";

export function Sidebar() {
  const width = useWorkspace((s) => s.sidebarWidth);
  const vault = useWorkspace((s) => s.vault);
  const error = useWorkspace((s) => s.error);

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-r border-hairline bg-chrome">
      <header className="flex h-9 shrink-0 items-center px-3 text-xs font-medium text-ink-muted">
        {vault ? vault.name : "파일 탐색기"}
      </header>

      {error !== null ? (
        <div className="flex-1 overflow-y-auto px-3 text-sm text-danger">{error}</div>
      ) : vault === null ? (
        <div className="flex-1 px-3 text-sm text-ink-muted">폴더를 열면 노트가 여기 보인다.</div>
      ) : (
        <FileTree />
      )}

      <VaultSwitcher />
    </aside>
  );
}
```

- [ ] **Step 4: `FileTree.tsx` 가 `.md` 를 떼고 그린다**

`Row` 안에서 `const isDir = node.kind === "dir";` 다음 줄에 한 줄을 넣는다.

```tsx
// .md 만 보여주므로 확장자가 정보를 주지 않는다. path 는 .md 를 유지한다.
const label = isDir ? node.name : node.name.replace(/\.md$/i, "");
```

그리고 이름을 그리는 `<span>` 의 내용을 `{node.name}` 에서 `{label}` 로 바꾼다.

```tsx
<span className="truncate">{label}</span>
```

- [ ] **Step 5: 창이 뜨면 마지막 볼트를 연다**

`src/renderer/app/Shell.tsx` 의 import 에 `useEffect` 를 더하고(이미 `useState` 를 `react` 에서 가져오고 있다), `Shell` 컴포넌트 본문 맨 위에 효과를 넣는다.

```tsx
import { useEffect, useState } from "react";
```

```tsx
export function Shell() {
  const selected = useWorkspace((s) => s.selected);
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);

  // 마지막으로 연 볼트를 되살린다. StrictMode 가 개발 중 두 번 부르지만
  // 읽기만 하므로 결과가 같다.
  useEffect(() => {
    void useWorkspace.getState().loadLastVault();
  }, []);
```

- [ ] **Step 6: 정적 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **27개** 그대로

- [ ] **Step 7: 실제로 볼트를 열어 본다**

이 태스크의 통과 조건이다. 화면을 볼 수 없으므로 관찰 가능한 것만 확인하고, 모양 판단은 사람에게 넘긴다.

1. `tasklist | grep -ci electron.exe` 가 0인지 확인하고, 아니면 죽인다
2. 터미널 A: `npm run dev`
3. 터미널 B: `npm start` (출력을 파일로)
4. 프로세스가 4 근처인지, main 출력에 `Unable to load preload script` 가 없는지 확인한다
5. 둘 다 죽인다

폴더 선택 창은 사람이 눌러야 뜨므로 에이전트가 확인할 수 없다. **그 부분은 보고서에 "사람 확인 필요" 로 적는다.**

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: 사이드바 하단에 볼트 전환기를 단다"
```

---

### Task 9: 문서 갱신

**Files:**

- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: 스텁 개수를 다시 센다**

Run:

```bash
for d in core main preload cli; do echo "src/$d: $(grep -rn 'unimplemented:' src/$d --include=*.ts | wc -l)"; done
```

관찰한 숫자를 그대로 쓴다. 추측하지 않는다.

- [ ] **Step 2: `CLAUDE.md` §1 의 `src/main/` · `src/preload/` 행을 고친다**

현재 그 행은 `` `main/index.ts` 만 채워졌다(창·메뉴). `ipc.ts`·`keys.ts`·`preload/` 는 스텁 유지 `` 로 돼 있다. 이제 `ipc.ts` 와 `preload/` 도 채워졌으므로 다음으로 바꾼다.

```
`index.ts`·`ipc.ts`·`preload/` 가 채워졌다. `keys.ts` 는 스텁 유지
```

- [ ] **Step 3: `CLAUDE.md` §5 의 스텁 개수를 Step 1 의 실측으로 맞춘다**

현재 문장은 이렇다.

```
**버그가 아니다.** `src/core` 는 아직 38곳이 이 상태다 (`main` 4 · `preload` 1 · `cli` 0).
```

네 숫자를 전부 Step 1 의 실측으로 바꾼다. **추측하지 말고 센 값을 그대로 쓴다** — 이 계획대로면 `openVault` 하나가 채워져 `core` 가 줄고, `registerHandlers` 와 `exposeApi` 가 채워져 `main` 과 `preload` 가 줄지만, 확인은 Step 1 의 출력으로 한다.

바로 아래 두 줄도 함께 본다.

```
`core/assets.ts` · `core/prompts/load.ts` · `main/ipc.ts` 의 `wrap()` 외에,
`main/index.ts` 와 `renderer/` 전체는 이제 실동작한다 (7·8단계 진행 중).
```

`main/ipc.ts` 는 이제 `wrap()` 만이 아니라 전체가 실동작하고 `preload/` 도 그렇다. 두 줄을 그 사실에 맞게 고친다.

- [ ] **Step 4: `README.md` 단계 표의 7·8단계 행을 고친다**

두 행 모두 이제 사실이 아니다.

바꾸기 전:

```
| 7    | Electron 셸                 | 창·메뉴만. IPC·preload 없음                 |
| 8    | 편집 UI · 그래프 뷰         | 왼쪽 크롬(목 데이터). 에디터·그래프 뷰 없음 |
```

바꾼 뒤:

```
| 7    | Electron 셸                 | 창·메뉴·preload·IPC. API 키 저장은 아직     |
| 8    | 편집 UI · 그래프 뷰         | 왼쪽 크롬(실제 볼트). 에디터·그래프 뷰 없음 |
```

prettier 가 표 폭을 다시 맞추므로 정렬은 신경 쓰지 않아도 된다.

- [ ] **Step 5: 검증하고 커밋**

Run: `npx prettier --check .`

```bash
git add CLAUDE.md README.md
git commit -m "docs: IPC 와 preload 가 들어온 것을 반영한다"
```

---

## 통과 조건 (전체)

- `npx prettier --check .` · `npm run lint` · `npm run typecheck` · `npm test` 전부 통과
- 테스트 **27개 / 5파일**
- `npm start` 한 번으로 preload 빌드까지 끝난다
- main 출력에 `Unable to load preload script` 가 없다
- **사람이 확인할 것** — 하단 전환기를 눌러 폴더 선택 창이 뜨는지, `dev/piecepool-vault-personal` 을 고르면 `wiki/`·`inbox/`·`sources/` 가 뜨고 `.obsidian`·`.piecepool` 은 안 보이는지, 파일명에 `.md` 가 없는지, 껐다 켜면 같은 볼트가 열리는지

## 범위 밖

파일 내용 읽기 · 에디터 · 파일 감시 · 최근 볼트 목록 · git · 인덱스 · 링크 · 그래프 ·
새 노트 만들기 · 우클릭 메뉴 · 사이드바 상단 아이콘 줄 · `electron-vite` · 프로덕션 빌드 · CSP
