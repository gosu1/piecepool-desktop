# 옵시디언식 좌측 크롬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 옵시디언의 리본·파일 탐색기 트리·3분할 셸을 목 데이터 위에 만든다.

**Architecture:** `renderer/` 는 `core/` 를 import 할 수 없다(lint 강제). 따라서 UI 는 zustand 스토어 하나에 담긴 목 트리만 보고, 나중에 그 스토어의 소스를 IPC 로 갈아끼우는 것으로 엔진과 합류한다. main 은 Electron 이 `.ts` 를 직접 실행하므로 번들하지 않고, vite 는 renderer 만 담당한다.

**Tech Stack:** React · zustand · Tailwind v4 · vite · Electron 44

**설계문서:** `docs/superpowers/specs/2026-09-14-obsidian-chrome-design.md`

## Global Constraints

모든 태스크에 적용된다.

- **`.ts`·`.tsx` 확장자를 import 에 반드시 붙인다.** `node` 가 `.ts` 를 직접 실행하므로 확장자를 추론하지 않는다
- **`enum`·`namespace`·생성자 파라미터 프로퍼티 금지.** type stripping 이 코드를 만들지 않으므로 죽는다 (lint 가 잡는다)
- **`src/shared/types.ts` 는 FROZEN.** 이 계획에서 한 줄도 고치지 않는다
- **`renderer/` 에서 `core/`·`main/`·`cli/` 를 import 하지 않는다** (lint 가 잡는다)
- **`src/core/`·`src/preload/` 의 스텁을 건드리지 않는다**
- **DOM 테스트를 만들지 않는다.** `vitest.config.ts` 의 include 는 `src/**/*.test.ts` 이고 environment 는 `node` 다. 순수 상태 로직만 테스트하고, 모양은 사람이 창을 열어 판단한다 (CLAUDE.md §7)
- **매 커밋 전 `npx prettier --write .` 을 돌린다.** CI 가 `--check` 로 돈다
- **커밋 메시지**는 Conventional Commits, 타입은 영어 설명은 한국어. 끝에 두 줄을 붙인다

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012JaHYUbJEzRicYDA3Z6HTS
  ```

- **브랜치는 `feat/electron-shell`.** `main` 에 직접 커밋하지 않는다
- Node >= 22.18

---

### Task 1: React 배선

창에 React 앱이 뜨는 데까지. 설정 파일 손질을 전부 여기 접는다 — 하나라도 빠지면 다음 태스크가 시작도 안 된다.

**Files:**

- Modify: `package.json` (의존성 · 스크립트)
- Create: `vite.config.ts`
- Modify: `tsconfig.web.json`
- Modify: `eslint.config.js`
- Modify: `src/renderer/index.html` (전체 교체)
- Create: `src/renderer/main.tsx`
- Delete: `src/renderer/main.ts`
- Create: `src/renderer/styles/tokens.css`
- Modify: `src/main/index.ts` (`loadFile` → `loadURL`)

**Interfaces:**

- Consumes: 없음
- Produces: `mount(): void` — `src/renderer/main.tsx`. 기존 스텁의 시그니처를 유지한다

- [ ] **Step 1: 의존성 설치**

```bash
npm i -D react react-dom zustand @types/react @types/react-dom @vitejs/plugin-react vite tailwindcss @tailwindcss/vite
```

전부 `devDependencies` 에 넣는다. renderer 코드는 vite 가 번들하므로 패키징 시 `node_modules` 에 들어갈 필요가 없다.

- [ ] **Step 2: `vite.config.ts` 생성**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// renderer 만 담당한다. main 은 electron 이 .ts 를 직접 실행하므로 번들하지 않는다.
// 3타깃 빌드(electron-vite)는 패키징을 시작할 때 정한다.
export default defineConfig({
  root: "src/renderer",
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "../../out/renderer", emptyOutDir: true },
});
```

`strictPort` 를 켜는 이유: 포트가 밀리면 main 이 박아 둔 5173 과 어긋나 빈 창이 뜨는데, 에러가 아니라 침묵이라 원인을 찾기 어렵다.

- [ ] **Step 3: `tsconfig.web.json` 에 jsx 추가**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": [],
    "jsx": "react-jsx"
  },
  "include": ["src/shared", "src/renderer"]
}
```

- [ ] **Step 4: `eslint.config.js` 가 `.tsx` 를 보게 한다**

경계 규칙 블록의 `files: ["src/**/*.ts"]` 를 찾아 `files: ["src/**/*.{ts,tsx}"]` 로 바꾼다. 한 곳뿐이다.

빠뜨리면 `renderer/` → `core/` import 금지 같은 규칙이 새 `.tsx` 파일에만 조용히 비활성된다. 에러가 아니라 침묵이라 아무도 모른다.

- [ ] **Step 5: `src/renderer/index.html` 전체 교체**

```html
<!doctype html>
<html lang="ko" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <title>PiecePool</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: `src/renderer/styles/tokens.css` 생성**

구 레포 `src/styles/index.css` 에서 발췌한다. 다크로 고정했으므로 라이트 블록은 가져오지 않고 다크 값을 `:root` 에 둔다. `data-theme="dark"` 는 `@custom-variant` 가 `dark:` 유틸리티를 켜는 데 쓰이므로 html 에 남긴다.

```css
@import "tailwindcss";

/* PiecePool 시각 언어 — 구 레포 src/styles/index.css 에서 발췌.
   시맨틱 토큰(--ds-*)을 @theme inline 으로 Tailwind 유틸리티에 연결한다. */

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme inline {
  --color-canvas: var(--ds-canvas);
  --color-surface: var(--ds-surface);
  --color-surface-soft: var(--ds-surface-soft);
  /* chrome — 리본·사이드바·타이틀바 전용 표면 (에디터보다 짙은 2단 명도) */
  --color-chrome: var(--ds-chrome);

  --color-ink: var(--ds-ink);
  --color-ink-2: var(--ds-ink-2);
  --color-ink-muted: var(--ds-ink-muted);
  --color-ink-faint: var(--ds-ink-faint);

  --color-hairline: var(--ds-hairline);

  --color-primary: var(--ds-primary);
  --color-primary-active: var(--ds-primary-active);
  --color-on-primary: var(--ds-on-primary);

  --color-fill: var(--ds-fill);
  --color-on-fill: var(--ds-on-fill);
  --color-fill-subtle: var(--ds-fill-subtle);
}

:root {
  --ds-canvas: #1e1e1e;
  --ds-surface: #262626;
  --ds-surface-soft: #303030;
  --ds-chrome: #262626;

  --ds-ink: #dadada;
  --ds-ink-2: #b8b8b8;
  --ds-ink-muted: #9a9a9a;
  --ds-ink-faint: #6e6e6e;

  --ds-hairline: #363636;

  --ds-primary: #4d8df0;
  --ds-primary-active: #3b7ad6;
  --ds-on-primary: #ffffff;

  --ds-fill: #141414;
  --ds-on-fill: #dadada;
  --ds-fill-subtle: rgba(255, 255, 255, 0.07);

  color-scheme: dark;
}

@layer base {
  html,
  body,
  #root {
    height: 100%;
  }
  /* 터치패드 팬 시 크로미움 기본 고무줄 튕김 차단 */
  html,
  body {
    overscroll-behavior: none;
  }
  body {
    margin: 0;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
  }
}
```

- [ ] **Step 7: `src/renderer/main.ts` 를 지우고 `main.tsx` 생성**

```bash
git rm src/renderer/main.ts
```

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";

/** UI 와 상태만. fs·API 키·직접 네트워크 호출은 여기 없다. */
export function mount(): void {
  const el = document.getElementById("root");
  if (!el) throw new Error("#root 를 찾지 못했다");
  createRoot(el).render(
    <StrictMode>
      <div className="grid h-full place-items-center bg-canvas text-ink">PiecePool</div>
    </StrictMode>,
  );
}

mount();
```

- [ ] **Step 8: `src/main/index.ts` 가 dev 서버를 보게 한다**

`import { join } from "node:path";` 줄을 삭제하고(고아가 된다), import 아래에 상수를 둔다.

```ts
// vite dev 서버를 본다. 프로덕션 빌드 경로(out/renderer)는 패키징을 시작할 때 정한다.
const DEV_URL = "http://localhost:5173";
```

`createWindow` 의 `void win.loadFile(...)` 한 줄을 바꾼다.

```ts
void win.loadURL(DEV_URL);
```

- [ ] **Step 9: `package.json` 에 dev 스크립트 추가**

`"start": "electron ."` 바로 위에 넣는다.

```json
"dev": "vite",
```

- [ ] **Step 10: 정적 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과. 테스트는 기존 2개가 그대로 통과한다.

lint 가 `import-x/no-unresolved` 로 `./styles/tokens.css` 를 못 찾는다고 하면, `eslint.config.js` 의 resolver 확장자에 `".css"` 를 더한다.

```js
"import-x/resolver": { node: { extensions: [".ts", ".tsx", ".css"] } },
```

이 줄을 미리 고치지 않는 이유: resolver 가 확장자가 명시된 경로를 그대로 찾을 수도 있어서, 실제로 실패할 때만 손대는 게 맞다.

- [ ] **Step 11: 실행 확인**

터미널 1: `npm run dev` → `Local: http://localhost:5173/` 이 뜬다
터미널 2: `npm start`

Expected: 어두운 배경(#1e1e1e)에 "PiecePool" 이 가운데 밝은 글자로 뜬다. 배경이 흰색이면 `tokens.css` 가 안 물린 것이다.

- [ ] **Step 12: 커밋**

```bash
git add -A
git commit -m "feat: renderer 에 React·vite·Tailwind 를 배선한다"
```

---

### Task 2: 워크스페이스 스토어 (TDD)

순수 상태 로직. 이 태스크만 자동 테스트가 있다.

**Files:**

- Create: `src/renderer/store/workspace.ts`
- Test: `src/renderer/store/workspace.test.ts`

**Interfaces:**

- Consumes: 없음
- Produces:
  - `interface TreeNode { name: string; path: string; kind: "dir" | "file"; children?: TreeNode[] }`
  - `clampWidth(px: number): number`
  - `MIN_SIDEBAR_WIDTH = 180` · `MAX_SIDEBAR_WIDTH = 480` · `RIBBON_WIDTH = 48`
  - `useWorkspace` — zustand 훅. 상태 `tree` · `expanded: Set<string>` · `selected: string | null` · `sidebarOpen: boolean` · `sidebarWidth: number`, 동작 `toggleFolder(path)` · `select(path)` · `toggleSidebar()` · `setSidebarWidth(px)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/renderer/store/workspace.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { clampWidth, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, useWorkspace } from "./workspace.ts";

const initial = useWorkspace.getState();

beforeEach(() => {
  useWorkspace.setState({
    expanded: new Set(initial.expanded),
    selected: null,
    sidebarOpen: true,
    sidebarWidth: 240,
  });
});

describe("clampWidth", () => {
  it("최소보다 작으면 최소로 올린다", () => {
    expect(clampWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
  });

  it("최대보다 크면 최대로 내린다", () => {
    expect(clampWidth(9999)).toBe(MAX_SIDEBAR_WIDTH);
  });

  it("범위 안이면 그대로 둔다", () => {
    expect(clampWidth(300)).toBe(300);
  });
});

describe("toggleFolder", () => {
  it("닫힌 폴더를 열고 다시 닫는다", () => {
    const { toggleFolder } = useWorkspace.getState();
    toggleFolder("inbox");
    expect(useWorkspace.getState().expanded.has("inbox")).toBe(true);
    toggleFolder("inbox");
    expect(useWorkspace.getState().expanded.has("inbox")).toBe(false);
  });

  it("기존 Set 을 그 자리에서 고치지 않는다", () => {
    const before = useWorkspace.getState().expanded;
    useWorkspace.getState().toggleFolder("inbox");
    expect(useWorkspace.getState().expanded).not.toBe(before);
  });
});

describe("select", () => {
  it("선택한 경로를 담는다", () => {
    useWorkspace.getState().select("wiki/트랜스포머.md");
    expect(useWorkspace.getState().selected).toBe("wiki/트랜스포머.md");
  });
});

describe("toggleSidebar", () => {
  it("열림과 닫힘을 뒤집는다", () => {
    useWorkspace.getState().toggleSidebar();
    expect(useWorkspace.getState().sidebarOpen).toBe(false);
    useWorkspace.getState().toggleSidebar();
    expect(useWorkspace.getState().sidebarOpen).toBe(true);
  });
});

describe("setSidebarWidth", () => {
  it("클램프를 거쳐 들어간다", () => {
    useWorkspace.getState().setSidebarWidth(10_000);
    expect(useWorkspace.getState().sidebarWidth).toBe(MAX_SIDEBAR_WIDTH);
  });
});
```

"그 자리에서 고치지 않는다" 테스트가 중요하다. `Set` 을 `.add()` 로 직접 고치면 참조가 그대로라 zustand 가 변경을 감지하지 못하고, **타입은 통과하는데 화면만 안 바뀐다.**

- [ ] **Step 2: 실패를 확인한다**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./workspace.ts"`

- [ ] **Step 3: 스토어를 만든다**

`src/renderer/store/workspace.ts`

```ts
import { create } from "zustand";

export interface TreeNode {
  name: string;
  /** 볼트 루트 기준 상대경로. POSIX 구분자로 고정한다. */
  path: string;
  kind: "dir" | "file";
  children?: TreeNode[];
}

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
export const RIBBON_WIDTH = 48;

export function clampWidth(px: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, px));
}

/**
 * 목 데이터. 재구축 설계 §4.2 의 볼트 레이아웃을 그대로 흉내낸다 —
 * IPC 가 생기면 이 상수만 교체되고 UI 는 그대로다.
 */
const MOCK_TREE: TreeNode[] = [
  {
    name: "wiki",
    path: "wiki",
    kind: "dir",
    children: [
      { name: "트랜스포머.md", path: "wiki/트랜스포머.md", kind: "file" },
      { name: "어텐션.md", path: "wiki/어텐션.md", kind: "file" },
      {
        name: "논문",
        path: "wiki/논문",
        kind: "dir",
        children: [
          {
            name: "Attention Is All You Need.md",
            path: "wiki/논문/Attention Is All You Need.md",
            kind: "file",
          },
        ],
      },
    ],
  },
  {
    name: "inbox",
    path: "inbox",
    kind: "dir",
    children: [{ name: "2026-09-14 메모.md", path: "inbox/2026-09-14 메모.md", kind: "file" }],
  },
  {
    name: "sources",
    path: "sources",
    kind: "dir",
    children: [
      {
        name: "files",
        path: "sources/files",
        kind: "dir",
        children: [{ name: "attention.pdf", path: "sources/files/attention.pdf", kind: "file" }],
      },
    ],
  },
];

interface WorkspaceState {
  tree: TreeNode[];
  expanded: Set<string>;
  selected: string | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleFolder: (path: string) => void;
  select: (path: string) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  tree: MOCK_TREE,
  expanded: new Set(["wiki"]),
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
}));
```

- [ ] **Step 4: 통과를 확인한다**

Run: `npm test`
Expected: PASS — 테스트 파일 2개, 테스트 10개

- [ ] **Step 5: 정적 검사와 커밋**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
git add -A
git commit -m "feat: 워크스페이스 스토어와 목 트리를 만든다"
```

---

### Task 3: 3분할 셸

리본·사이드바·본문이 색으로 구분돼 보이는 데까지. 아직 아무것도 클릭되지 않는다.

**Files:**

- Create: `src/renderer/app/Shell.tsx`
- Create: `src/renderer/app/Ribbon.tsx`
- Create: `src/renderer/app/Sidebar.tsx`
- Modify: `src/renderer/main.tsx`

**Interfaces:**

- Consumes: `useWorkspace` (Task 2)
- Produces: `Shell()` · `Ribbon()` · `Sidebar()` — 전부 props 없는 컴포넌트. 상태는 스토어에서 직접 읽는다

- [ ] **Step 1: `src/renderer/app/Ribbon.tsx`**

```tsx
import { RIBBON_WIDTH } from "../store/workspace.ts";

/** 좌측 아이콘 바. 이번 조각에서 동작하는 아이콘은 Task 5 의 토글 하나뿐이다. */
export function Ribbon() {
  return (
    <nav
      aria-label="리본"
      style={{ width: RIBBON_WIDTH }}
      className="flex shrink-0 flex-col items-center gap-1 border-r border-hairline bg-chrome pt-2"
    />
  );
}
```

너비를 `w-12` 로 쓰지 않고 상수를 쓰는 이유: Task 5 의 드래그 핸들이 `e.clientX - RIBBON_WIDTH` 로 사이드바 너비를 계산한다. 둘이 어긋나면 드래그할 때마다 커서와 경계선이 벌어지는데, 타입은 아무것도 안 잡아 준다.

- [ ] **Step 2: `src/renderer/app/Sidebar.tsx`**

```tsx
import { useWorkspace } from "../store/workspace.ts";

export function Sidebar() {
  const width = useWorkspace((s) => s.sidebarWidth);

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-r border-hairline bg-chrome">
      <header className="flex h-9 shrink-0 items-center px-3 text-xs font-medium text-ink-muted">
        파일 탐색기
      </header>
    </aside>
  );
}
```

- [ ] **Step 3: `src/renderer/app/Shell.tsx`**

```tsx
import { Ribbon } from "./Ribbon.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { useWorkspace } from "../store/workspace.ts";

export function Shell() {
  const selected = useWorkspace((s) => s.selected);

  return (
    <div className="flex h-full bg-canvas text-ink">
      <Ribbon />
      <Sidebar />
      <main className="grid flex-1 place-items-center text-sm text-ink-muted">
        {selected ?? "선택된 파일 없음"}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: `main.tsx` 가 `Shell` 을 그리게 한다**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./app/Shell.tsx";
import "./styles/tokens.css";

/** UI 와 상태만. fs·API 키·직접 네트워크 호출은 여기 없다. */
export function mount(): void {
  const el = document.getElementById("root");
  if (!el) throw new Error("#root 를 찾지 못했다");
  createRoot(el).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
}

mount();
```

- [ ] **Step 5: 확인**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`

창을 띄운다 (`npm run dev` + `npm start`).

Expected: 왼쪽에 48px 짙은 바, 그 옆 240px 짙은 사이드바에 "파일 탐색기" 라벨, 나머지는 더 어두운 본문에 "선택된 파일 없음". 세 영역 사이에 얇은 경계선이 보인다.

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 리본·사이드바·본문 3분할 셸을 만든다"
```

---

### Task 4: 파일 트리

목 트리가 그려지고 폴더가 접히고 파일이 선택된다.

**Files:**

- Create: `src/renderer/app/FileTree.tsx`
- Modify: `src/renderer/app/Sidebar.tsx`

**Interfaces:**

- Consumes: `useWorkspace` · `TreeNode` (Task 2) · `Sidebar()` (Task 3)
- Produces: `FileTree()` — props 없음

- [ ] **Step 1: `src/renderer/app/FileTree.tsx`**

```tsx
import { useWorkspace, type TreeNode } from "../store/workspace.ts";

function Row({ node, depth }: { node: TreeNode; depth: number }) {
  const isDir = node.kind === "dir";
  const expanded = useWorkspace((s) => s.expanded.has(node.path));
  const selected = useWorkspace((s) => s.selected === node.path);
  const toggleFolder = useWorkspace((s) => s.toggleFolder);
  const select = useWorkspace((s) => s.select);

  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? toggleFolder(node.path) : select(node.path))}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`flex h-6 w-full items-center gap-1 pr-2 text-left text-sm ${
          selected ? "bg-fill-subtle text-ink" : "text-ink-2 hover:bg-fill-subtle"
        }`}
      >
        <span className="w-3 shrink-0 text-ink-faint">{isDir ? (expanded ? "▾" : "▸") : ""}</span>
        <span className="truncate">{node.name}</span>
      </button>

      {isDir &&
        expanded &&
        node.children?.map((child) => <Row key={child.path} node={child} depth={depth + 1} />)}
    </>
  );
}

export function FileTree() {
  const tree = useWorkspace((s) => s.tree);

  return (
    <div className="flex-1 overflow-y-auto pb-2">
      {tree.map((node) => (
        <Row key={node.path} node={node} depth={0} />
      ))}
    </div>
  );
}
```

선택자를 `(s) => s.expanded.has(node.path)` 처럼 **불리언으로 좁히는 것**이 중요하다. `s.expanded` 를 통째로 받으면 다른 폴더를 열 때마다 모든 행이 리렌더된다.

- [ ] **Step 2: `Sidebar.tsx` 에 붙인다**

```tsx
import { FileTree } from "./FileTree.tsx";
import { useWorkspace } from "../store/workspace.ts";

export function Sidebar() {
  const width = useWorkspace((s) => s.sidebarWidth);

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-r border-hairline bg-chrome">
      <header className="flex h-9 shrink-0 items-center px-3 text-xs font-medium text-ink-muted">
        파일 탐색기
      </header>
      <FileTree />
    </aside>
  );
}
```

- [ ] **Step 3: 확인**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`

창에서:

- `wiki` 가 펼쳐진 채로 시작하고 `▾` 가 보인다
- `▸ inbox` 를 클릭하면 펼쳐지고 화살표가 `▾` 로 바뀐다
- `wiki/논문` 을 열면 한 단 더 들여쓰기된다
- 파일을 클릭하면 배경이 밝아지고 본문에 경로가 뜬다

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: 파일 트리에 접기와 선택을 붙인다"
```

---

### Task 5: 리본 토글과 너비 드래그

남은 두 인터랙션.

**Files:**

- Modify: `src/renderer/app/Ribbon.tsx`
- Modify: `src/renderer/app/Shell.tsx`

**Interfaces:**

- Consumes: `useWorkspace` · `RIBBON_WIDTH` (Task 2) · `Ribbon()` · `Shell()` (Task 3)
- Produces: 없음 (기존 컴포넌트에 동작만 붙는다)

- [ ] **Step 1: `Ribbon.tsx` 에 토글 버튼**

```tsx
import { RIBBON_WIDTH, useWorkspace } from "../store/workspace.ts";

/** 좌측 아이콘 바. 동작하는 아이콘은 사이드바 토글 하나뿐이다. */
export function Ribbon() {
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);

  return (
    <nav
      aria-label="리본"
      style={{ width: RIBBON_WIDTH }}
      className="flex shrink-0 flex-col items-center gap-1 border-r border-hairline bg-chrome pt-2"
    >
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
        className="grid h-8 w-8 place-items-center rounded text-ink-muted hover:bg-fill-subtle hover:text-ink"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
        </svg>
      </button>
    </nav>
  );
}
```

- [ ] **Step 2: `Shell.tsx` 에 드래그 핸들과 접기 반영**

```tsx
import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Ribbon } from "./Ribbon.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { RIBBON_WIDTH, useWorkspace } from "../store/workspace.ts";

function ResizeHandle() {
  const setSidebarWidth = useWorkspace((s) => s.setSidebarWidth);
  const [dragging, setDragging] = useState(false);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 포인터 캡처 중에도 이벤트가 계속 오므로 dragging 으로 직접 막는다.
    if (dragging) setSidebarWidth(e.clientX - RIBBON_WIDTH);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary"
    />
  );
}

export function Shell() {
  const selected = useWorkspace((s) => s.selected);
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);

  return (
    <div className="flex h-full bg-canvas text-ink">
      <Ribbon />
      {sidebarOpen && (
        <>
          <Sidebar />
          <ResizeHandle />
        </>
      )}
      <main className="grid flex-1 place-items-center text-sm text-ink-muted">
        {selected ?? "선택된 파일 없음"}
      </main>
    </div>
  );
}
```

`setPointerCapture` 를 쓰는 이유: 드래그 중 커서가 본문 위로 넘어가도 이벤트가 핸들에 계속 오므로, `window` 에 리스너를 붙였다 떼는 코드가 필요 없다.

- [ ] **Step 3: 확인**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`

창에서 네 동작을 전부 확인한다.

- 폴더 접기/펼치기
- 경계선을 잡고 좌우로 끌면 사이드바 너비가 바뀌고 180~480 에서 멈춘다
- 리본 아이콘을 누르면 사이드바가 사라지고 다시 누르면 돌아온다
- 파일 클릭 시 하이라이트 + 본문에 경로

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: 사이드바 토글과 너비 드래그를 붙인다"
```

---

### Task 6: 문서 갱신

설계문서 §10 이 예고한 셋. CLAUDE.md 는 "발견한 사람이 그 PR 에 함께 넣는다" 가 규칙이므로 따로 합의받지 않는다.

**Files:**

- Modify: `CLAUDE.md`

**Interfaces:**

- Consumes: 없음
- Produces: 없음

- [ ] **Step 1: §1 표에서 만료된 줄을 고친다**

`src/renderer/` 행의 `**8단계까지 스텁 유지.** 지금 채우지 않는다` 를 다음으로 바꾼다.

```
**8단계 진행 중.** `app/`·`store/` 만 있다. `features/`·`ds/` 는 아직 없다
```

`src/main/` · `src/preload/` 행의 `**7단계까지 스텁 유지.** 지금 채우지 않는다` 를 다음으로 바꾼다.

```
`main/index.ts` 만 채워졌다(창·메뉴). `ipc.ts`·`keys.ts`·`preload/` 는 스텁 유지
```

- [ ] **Step 2: §4 "반드시 이렇게 하라" 에 한 줄 추가**

"제목 정규화는 `normalizeTitle()` 하나만 쓴다" 절 다음에 넣는다.

```markdown
### ESM 엔트리에서 top-level `await` 을 쓰지 마라

`src/main/index.ts` 는 Electron 의 엔트리다. Electron 은 **엔트리 모듈의 평가가 끝난 뒤에** `ready` 를 emit 하는데, `bootstrap()` 이 `app.whenReady()` 를 기다리므로 top-level `await` 을 걸면 서로를 기다린다.

에러도 없고 종료도 안 한다. **창 없는 프로세스 하나로 조용히 멈춘다.** `void bootstrap()` 인 이유다.
```

- [ ] **Step 3: §9 표에 Tailwind 를 추가한다**

"마크다운 에디터 | CodeMirror 6" 행 위에 넣는다.

```markdown
| 스타일 | Tailwind v4 + 구 레포 `--ds-*` 토큰 | 2026-09-14 크롬 설계 §3.2 |
```

- [ ] **Step 4: 확인과 커밋**

Run: `npx prettier --check .`

```bash
git add CLAUDE.md
git commit -m "docs: 8단계 착수를 CLAUDE.md 에 반영한다"
```

---

## 통과 조건 (전체)

- `npx prettier --check .` · `npm run lint` · `npm run typecheck` · `npm test` 전부 통과
- 테스트 파일 2개 / 테스트 10개
- 창에서 네 동작 확인 (Task 5 Step 3)
- 모양이 옵시디언 같은지는 **사람이 판단한다** (CLAUDE.md §7)

## 범위 밖

IPC · preload · 실제 볼트 읽기 · 리본 탭 전환 · 우클릭 메뉴 · 새 노트 · `ds/primitives` 이식 · 프로덕션 빌드 · 패키징 · 에디터 · 그래프 뷰
