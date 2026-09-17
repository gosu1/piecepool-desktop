# 쿼리 탭 껍데기 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리본의 그래프 버튼 아래에 쿼리 버튼이 생기고, 누르면 `쿼리` 탭이 열려 대화 화면의 뼈대(배너 + 비활성 입력창)가 뜬다. LLM 은 붙이지 않는다.

**Architecture:** `Tab` 판별 유니온에 `QueryTab` 을 더하고, `openGraphTab()` 과 같은 모양의 `openQueryTab()` 을 스토어에 둔다. 화면은 `features/query/QueryView.tsx` 하나이고 `NoteView` 가 `kind` 로 분기해 렌더한다. **`src/renderer/` 밖으로 한 줄도 나가지 않는다.**

**Tech Stack:** Electron 44 · React 19 · zustand · Tailwind v4 · vite · vitest (node)

**설계문서:** `docs/superpowers/specs/2026-09-16-query-tab-shell-design.md`

## Global Constraints

모든 태스크에 적용된다.

- **FROZEN 파일을 하나도 건드리지 않는다.** 이 계획이 여는 FROZEN 은 **없다.** `src/shared/ipc.ts` · `src/shared/types.ts` · `src/core/agent/tools.ts` · `src/core/agent/tasks/query.ts` 는 읽지도 고치지도 않는다. 고쳐야 할 것 같으면 **멈추고 묻는다** (CLAUDE.md §2)
- **`unimplemented` 스텁을 하나도 채우지 않는다.** `core/llm/*` · `agent/loop.ts` · `agent/tools.ts` · `tasks/query.ts` · `main/keys.ts` 는 **그대로 둔다**. `main/keys.ts` 는 CLAUDE.md §1 이 "스텁 유지" 로 못 박은 파일이다
- **새 npm 패키지를 설치하지 않는다.** 이 계획에 필요한 것은 전부 이미 있다
- **`src/renderer/` 는 `core/`·`main/`·`cli/` 를 import 할 수 없다** (lint 가 잡는다). `shared/` 는 가능하다
- **`.ts`/`.tsx` 확장자를 import 에 반드시 붙인다.** `node` 가 `.ts` 를 직접 실행하므로 확장자를 추론하지 않는다
- **`verbatimModuleSyntax: true`** — 타입만 쓰는 import 는 `import type` 이나 인라인 `type` 수식어를 붙인다
- **DOM 테스트를 만들지 않는다.** `vitest.config.ts` 는 `environment: "node"` · `include: ["src/**/*.test.ts"]` 다. `.tsx` 는 테스트 대상이 아니다 — 화면은 사람이 본다 (CLAUDE.md §7)
- **테스트는 135개 / 14파일에서 시작한다.** Task 1 이 5개를 더해 **140개** 가 된다. Task 2 는 더하지 않는다
- **매 커밋 전 `npx prettier --write .` 을 돌린다.** CI 가 `--check` 로 돈다
- **커밋 메시지**는 Conventional Commits, 타입은 영어 설명은 한국어. 끝에 한 줄을 **문자 그대로** 붙인다

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

- **브랜치는 `feat/electron-shell`.** `main` 에 직접 커밋하지 않는다
- **`src/renderer/app/TabStrip.tsx` 에 미커밋 변경이 있다.** 다른 작업이다. **건드리지 말고, `git add .` 으로 쓸어 담지 마라** — 커밋은 항상 경로를 찍어서 한다
- **앱을 띄워 확인하는 절차**(Task 2 에만 있다):
  1. `tasklist | grep -ci electron.exe` 가 0인지 확인한다. **0이 아니면 죽이지 말고 멈춰서 보고하라** — 사용자가 앱을 열어 두고 있을 수 있다
  2. `npm start` 하나면 된다. dev 서버까지 함께 뜬다(`scripts/dev.mjs`)
  3. `tasklist | grep -ci electron.exe` 가 **4 근처**인지 확인한다
  4. 출력에서 `Unable to load preload script` 를 grep 한다. **나오면 실패다**
  5. 끝나면 0으로 되돌린다. `netstat -ano | grep ':5173 '` 로 LISTENING 잔여를 확인하고, 남았으면 그 PID 만 죽인다

## 파일 구조

| 파일                                        | 책임                                         | 태스크 |
| ------------------------------------------- | -------------------------------------------- | ------ |
| `src/renderer/store/workspace.ts`           | `QUERY_TAB_ID` · `QueryTab` · `openQueryTab` | 1      |
| `src/renderer/store/workspace.test.ts`      | 쿼리 탭 5건                                  | 1      |
| `src/renderer/features/query/QueryView.tsx` | 배너 + 비활성 입력창 (새 파일)               | 1      |
| `src/renderer/app/NoteView.tsx`             | `kind === "query"` 분기                      | 1      |
| `src/renderer/app/Ribbon.tsx`               | 말풍선 버튼                                  | 2      |

태스크를 둘로 자른 이유: Task 1 은 **자동 검사(테스트 + `tsc`)만으로 완결**되고, Task 2 는 **사람이 앱을 띄워야만** 확인된다. 리뷰어가 한쪽만 물릴 수 있는 자리가 정확히 여기다.

Task 1 이 store·화면·`NoteView` 셋을 한꺼번에 담는 이유는 §4.1 때문이다 — `QueryTab` 이 유니온에 들어가는 순간 `NoteView` 가 `tsc` 에서 터지므로, 셋이 갈라지면 중간 커밋이 typecheck 를 통과하지 못한다.

---

### Task 1: 쿼리 탭이 스토어와 화면에 자리를 갖는다

**Files:**

- Modify: `src/renderer/store/workspace.test.ts` (끝에 `describe` 하나 추가 · import 한 줄)
- Modify: `src/renderer/store/workspace.ts`
- Create: `src/renderer/features/query/QueryView.tsx`
- Modify: `src/renderer/app/NoteView.tsx`

**Interfaces:**

- Consumes: `useWorkspace` · `applied` · `noteTabId` · `GRAPH_TAB_ID` — `src/renderer/store/workspace.ts` 에 이미 있다
- Produces:
  - `export const QUERY_TAB_ID = "query"` — 타입은 리터럴 `"query"`
  - `export interface QueryTab { kind: "query"; id: "query"; title: "쿼리" }`
  - `export type Tab = NoteTab | GraphTab | QueryTab`
  - `openQueryTab: () => void` — `WorkspaceState` 의 액션
  - `export function QueryView()` — `src/renderer/features/query/QueryView.tsx`. **props 없음.** 반환 타입은 적지 않는다 (추론에 맡긴다 — 이 레포의 다른 컴포넌트도 그렇다)

---

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`src/renderer/store/workspace.test.ts` **맨 위 import 블록**에서 `QUERY_TAB_ID` 를 추가한다.
기존 목록이 대소문자를 무시한 알파벳 순이므로 **`noteTabId` 와 `stripFrontmatter` 사이**에 넣는다 (prettier 는 import 순서를 안 바꾼다 — 사람이 맞춘다).

```ts
import {
  applied,
  clampWidth,
  GRAPH_TAB_ID,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  noteTabId,
  QUERY_TAB_ID,
  stripFrontmatter,
  useWorkspace,
} from "./workspace.ts";
```

그리고 **파일 맨 끝**, `describe("그래프 탭", …)` 블록 **다음에** 아래를 붙인다.

```ts
describe("쿼리 탭", () => {
  it("연 적 없으면 새로 만들고 활성으로 둔다", () => {
    useWorkspace.getState().openQueryTab();
    const s = useWorkspace.getState();
    expect(s.tabs).toEqual([{ kind: "query", id: QUERY_TAB_ID, title: "쿼리" }]);
    expect(s.activeTab).toBe(QUERY_TAB_ID);
  });

  it("두 번 눌러도 탭이 둘이 되지 않는다", () => {
    const { openQueryTab } = useWorkspace.getState();
    openQueryTab();
    openQueryTab();
    expect(useWorkspace.getState().tabs).toHaveLength(1);
  });

  it("노트 탭·그래프 탭과 키 공간이 겹치지 않는다", () => {
    useWorkspace.setState({
      tabs: [
        {
          kind: "note",
          id: noteTabId("query"),
          path: "query",
          title: "query",
          body: "",
          error: null,
          seq: 1,
        },
        { kind: "graph", id: GRAPH_TAB_ID, title: "그래프" },
      ],
      activeTab: noteTabId("query"),
    });
    useWorkspace.getState().openQueryTab();
    expect(useWorkspace.getState().tabs).toHaveLength(3);
  });

  it("focusTab 은 쿼리 탭에서 selected 를 건드리지 않는다", () => {
    useWorkspace.setState({
      tabs: [
        {
          kind: "note",
          id: noteTabId("a.md"),
          path: "a.md",
          title: "a",
          body: "",
          error: null,
          seq: 1,
        },
        { kind: "query", id: QUERY_TAB_ID, title: "쿼리" },
      ],
      activeTab: noteTabId("a.md"),
      selected: "a.md",
    });
    useWorkspace.getState().focusTab(QUERY_TAB_ID);
    const s = useWorkspace.getState();
    expect(s.activeTab).toBe(QUERY_TAB_ID);
    expect(s.selected).toBe("a.md");
  });

  it("볼트를 바꾸면 쿼리 탭도 함께 닫힌다", () => {
    useWorkspace.getState().openQueryTab();
    const next = applied({
      ok: true,
      value: { root: "/새볼트", name: "새볼트", tree: [] },
    });
    expect(next.tabs).toEqual([]);
    expect(next.activeTab).toBeNull();
  });
});
```

설계 §8.1 은 4건을 적었다. 네 번째(`focusTab`)를 **하나 더 넣었다** — 설계 §4.1 이 "`focusTab` 은 고치지 않아도 맞다" 고 주장하는데, 그 주장을 못 박는 것이 이 테스트다. 주장만 있고 테스트가 없으면 다음 사람이 `focusTab` 을 고칠 때 조용히 깨진다.

- [ ] **Step 2: 돌려서 실패를 확인한다**

```bash
npx vitest run src/renderer/store/workspace.test.ts
```

Expected: **`Tests 4 failed | 30 passed (34)`** — `TypeError: useWorkspace.getState(...).openQueryTab is not a function`.

**둘을 확인하고 넘어간다.**

- **기존 30건은 그대로 초록이다.** vite 는 없는 named export 를 `SyntaxError` 로 던지지 않고 `undefined` 로 넘긴다 — 모듈은 정상적으로 뜬다
- **5건 중 `focusTab` 하나는 구현 없이 통과한다.** `QUERY_TAB_ID` 가 `undefined` 라 `focusTab(undefined)` 가 `id: undefined` 인 탭을 찾아내고, `expect(activeTab).toBe(undefined)` 가 맞아떨어진다. **거짓 초록이다.** Step 4 에서 상수가 `"query"` 가 되면 비로소 진짜를 잰다

- [ ] **Step 3: 스토어에 자리를 만든다**

`src/renderer/store/workspace.ts` 에서 **세 곳**을 고친다.

**(1)** `GRAPH_TAB_ID` 선언 **바로 아래**에 상수를 더한다.

```ts
/** 그래프 탭은 하나뿐이라 id 가 곧 상수다. */
export const GRAPH_TAB_ID = "graph";

/** 쿼리 탭도 하나뿐이다. 세션을 여럿 두는 것은 대화가 생긴 뒤의 일이다. */
export const QUERY_TAB_ID = "query";
```

**(2)** `GraphTab` 인터페이스와 `Tab` 별칭을 찾아, 그 사이에 `QueryTab` 을 끼우고 유니온을 넓힌다.

```ts
/** 그래프 탭. 파일이 아니라 경로가 없다. */
export interface GraphTab {
  kind: "graph";
  id: "graph";
  title: "그래프";
}

/** 쿼리 세션 탭. 그래프처럼 경로가 없고, 아직 담는 상태도 없다. */
export interface QueryTab {
  kind: "query";
  id: "query";
  title: "쿼리";
}

export type Tab = NoteTab | GraphTab | QueryTab;
```

**(3)** `WorkspaceState` 인터페이스의 `openGraphTab: () => void;` **바로 아래**에 액션을 선언하고,

```ts
  openGraphTab: () => void;
  openQueryTab: () => void;
```

`create<WorkspaceState>` 안의 `openGraphTab` 구현 **바로 아래**에 구현을 둔다.

```ts
  openQueryTab: () =>
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === QUERY_TAB_ID)
        ? s.tabs
        : [...s.tabs, { kind: "query", id: QUERY_TAB_ID, title: "쿼리" }],
      activeTab: QUERY_TAB_ID,
    })),
```

`focusTab` 과 `closeTab` 은 **고치지 않는다.** `focusTab` 의 `t.kind === "note" ? … : …` 는 쿼리 탭을 자동으로 "경로 없음" 쪽으로 떨어뜨리고, `closeTab` 은 id 만 본다.

- [ ] **Step 4: 돌려서 테스트가 통과하는지 본다**

```bash
npx vitest run src/renderer/store/workspace.test.ts
```

Expected: **PASS.** 이 파일의 테스트가 전부 초록이고, 새 `describe("쿼리 탭")` 5건이 포함된다.

- [ ] **Step 5: typecheck 를 돌려 두 번째 빨간불을 본다**

```bash
npm run typecheck
```

Expected: **FAIL.** `src/renderer/app/NoteView.tsx` 에서 이런 에러가 난다.

```
error TS2339: Property 'error' does not exist on type 'NoteTab | QueryTab'.
  Property 'error' does not exist on type 'QueryTab'.
```

**이것이 설계 §4.1 이 예고한 자리다.** `noteBody()` 가 `tab.kind === "graph"` 만 걸러낸 뒤 나머지를 노트로 보고 `tab.error` 를 읽는데, 유니온에 `QueryTab` 이 들어와 그 가정이 깨졌다. 컴파일러가 고칠 곳을 정확히 짚어 준다.

- [ ] **Step 6: `QueryView` 를 만든다**

`src/renderer/features/query/QueryView.tsx` 를 새로 만든다.

```tsx
/**
 * 쿼리 세션 탭의 본문.
 *
 * 아직 LLM 이 붙지 않았다 — 배너와 **비활성** 입력창으로 자리만 잡는다(설계 §1.1).
 * 입력창이 자리를 실제로 차지하는 것이 중요하다. 다음 조각에서 `disabled` 를 떼면
 * 레이아웃이 그대로 살아난다.
 *
 * 그래프와 달리 계속 마운트해 두지 않는다 — 지킬 상태(배치·pan/zoom)가 없다(설계 §5).
 */
export function QueryView() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="m-4 rounded-md border border-hairline px-3 py-2 text-sm text-ink-muted">
        LLM 이 아직 연결되지 않았다. 대화는 다음 조각에서 붙는다.
      </div>

      {/* 답변이 쌓일 자리. 지금은 비어 있고, 입력창을 아래로 밀어 두는 일만 한다. */}
      <div className="min-h-0 flex-1" />

      <div className="m-4 flex items-end gap-2 rounded-md border border-hairline p-2">
        <textarea
          disabled
          rows={2}
          placeholder="물어보기…"
          aria-label="질문"
          className="min-w-0 flex-1 resize-none bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          disabled
          aria-label="보내기"
          className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-faint disabled:cursor-not-allowed"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M8 13.5V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
```

`app-no-drag` 는 붙이지 않는다. 창을 끄는 띠는 상단 32px 이고 그 자리는 `TabStrip` 이 덮는다 — `QueryView` 는 그 아래다.

- [ ] **Step 7: `NoteView` 가 분기하게 한다**

`src/renderer/app/NoteView.tsx` 에서 **두 곳**을 고친다.

**(1)** import 를 더한다. `GraphView` import 바로 아래에 둔다.

```tsx
import { GraphView } from "../features/graph/GraphView.tsx";
import { QueryView } from "../features/query/QueryView.tsx";
```

**(2)** `noteBody()` 안의 그래프 분기 **바로 아래**에 쿼리 분기를 넣는다.

```tsx
if (tab.kind === "graph") return null;
if (tab.kind === "query") return <QueryView />;
```

이 한 줄이 들어가면 그 아래 `tab.error` 에서 `tab` 은 다시 `NoteTab` 으로 좁혀진다.

`noteBody` 의 JSDoc 첫 줄도 지금 동작에 맞춘다.

```tsx
/**
 * 그래프 탭이 활성일 땐 GraphView 가 그리므로 이 함수는 null 을 반환해 자리를 비켜 준다.
 * 쿼리 탭은 반대다 — 지킬 상태가 없어 여기서 직접 그린다(설계 §5).
 */
```

- [ ] **Step 8: 자동 검사 넷을 전부 돌린다**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
```

Expected:

- `prettier` — 고친 파일들이 나열되거나 아무것도 안 나온다. 둘 다 정상
- `lint` — 출력 없음
- `typecheck` — 출력 없음 (Step 5 의 에러가 사라졌다)
- `test` — **`Test Files 14 passed (14)` · `Tests 140 passed (140)`**

파일 수가 14 그대로인 것이 맞다. 새 테스트는 기존 `workspace.test.ts` 에 들어갔다.

- [ ] **Step 9: 커밋한다**

`git add .` 을 쓰지 않는다 — `TabStrip.tsx` 의 미커밋 변경이 딸려 온다.

```bash
git add src/renderer/store/workspace.ts \
        src/renderer/store/workspace.test.ts \
        src/renderer/features/query/QueryView.tsx \
        src/renderer/app/NoteView.tsx

git commit -F - <<'EOF'
feat: 쿼리 탭이 스토어와 화면에 자리를 갖는다

Tab 유니온에 QueryTab 을 더하고 NoteView 가 kind 로 분기한다.
화면은 배너와 비활성 입력창뿐이다 — LLM 은 아직 붙지 않는다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

커밋 뒤 `git status --short` 로 `M src/renderer/app/TabStrip.tsx` 가 **그대로 남아 있는지** 확인한다. 사라졌으면 남의 작업을 쓸어 담은 것이다.

---

### Task 2: 리본에 쿼리 버튼을 단다

**Files:**

- Modify: `src/renderer/app/Ribbon.tsx`

**Interfaces:**

- Consumes: `QUERY_TAB_ID` · `openQueryTab` (Task 1) · `RibbonButton` (이미 `Ribbon.tsx` 안에 있다 — `label` · `active` · `onClick` · `children`)
- Produces: 없음. 이 태스크가 마지막이다

**자동 테스트가 없는 태스크다.** `vitest` 는 `.test.ts` 만 잡고 `environment: "node"` 라 `.tsx` 를 못 본다. 통과 조건은 **정적 검사 넷 + 사람이 앱을 띄워 보는 것**이다 (CLAUDE.md §7).

---

- [ ] **Step 1: 스토어에서 두 값을 더 읽는다**

`src/renderer/app/Ribbon.tsx` 의 `Ribbon()` 안, 기존 훅 네 줄 아래에 두 줄을 더한다.

```tsx
export function Ribbon() {
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);
  const openGraphTab = useWorkspace((s) => s.openGraphTab);
  const graphActive = useWorkspace((s) => s.activeTab === GRAPH_TAB_ID);
  const openQueryTab = useWorkspace((s) => s.openQueryTab);
  const queryActive = useWorkspace((s) => s.activeTab === QUERY_TAB_ID);
```

그리고 맨 위 import 에 `QUERY_TAB_ID` 를 더한다. **기존 줄 순서를 유지한다.**

```tsx
import { GRAPH_TAB_ID, QUERY_TAB_ID, RIBBON_WIDTH, useWorkspace } from "../store/workspace.ts";
```

- [ ] **Step 2: 버튼을 그래프 아래에 붙인다**

그래프 `RibbonButton` 을 닫는 `</RibbonButton>` **바로 아래**, `</nav>` **앞**에 넣는다.

```tsx
<RibbonButton label="쿼리" active={queryActive} onClick={openQueryTab}>
  {/* 말풍선 + 말줄임 셋. 사이드바 아이콘도 사각형이라, 점 셋으로 갈라 둔다. */}
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
  >
    <rect x="1.5" y="2.5" width="13" height="9" rx="2" />
    <path d="M5 11.5v2.6l3-2.6" />
    <circle cx="5.5" cy="7" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="8" cy="7" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="7" r="0.5" fill="currentColor" stroke="none" />
  </svg>
</RibbonButton>
```

`Ribbon` 의 JSDoc 도 지금 동작에 맞춘다.

```tsx
/** 좌측 아이콘 바. 사이드바 토글 · 그래프 · 쿼리 셋이다. */
```

- [ ] **Step 3: 정적 검사 넷을 돌린다**

```bash
npx prettier --write . && npm run lint && npm run typecheck && npm test
```

Expected: `lint`·`typecheck` 출력 없음. `test` 는 **`Tests 140 passed (140)`** — Task 1 에서 늘어난 그대로다. 이 태스크는 테스트를 더하지 않는다.

- [ ] **Step 4: 앱을 띄워 사람이 확인한다**

Global Constraints 의 5단계 절차를 그대로 따른다. 띄운 뒤 **아래 여덟을 눈으로 본다.**

1. 리본에서 **그래프 아래**에 말풍선 아이콘이 보이나
2. 누르면 `쿼리` 탭이 열리고 활성이 되나. 리본 버튼에 활성 표시(`bg-fill-subtle`)가 켜지나
3. **다시 눌러도 탭이 하나인가**
4. 배너 글자가 읽히고, 입력창을 클릭해도 **글자가 써지지 않나**
5. 그래프 탭과 쿼리 탭을 오갈 때 **둘 다 멀쩡한가** — 특히 그래프로 돌아왔을 때 pan/zoom 과 노드 위치가 그대로인가
6. 사이드바에서 노트를 열어 놓고 쿼리 탭으로 갔다가 돌아와도 노트 본문이 그대로인가
7. **볼트를 안 연 상태**에서도 쿼리 버튼이 눌리고 탭이 열리나 (설계 §7 — 그래프 버튼과 같게 둔 자리다)
8. 볼트 전환기로 **다른 볼트를 열면** 쿼리 탭이 함께 사라지나

**이 중 하나라도 어긋나면 멈추고 보고한다.** 고쳐서 넘기지 않는다.

비포·애프터 스크린샷은 **사용자에게 요청한다** (CLAUDE.md §7). 에이전트가 찍지 않는다.

- [ ] **Step 5: 커밋한다**

```bash
git add src/renderer/app/Ribbon.tsx

git commit -F - <<'EOF'
feat: 리본에서 쿼리 탭을 연다

그래프 아래에 말풍선 버튼 하나. 누르면 쿼리 탭이 열린다.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

`git status --short` 로 `M src/renderer/app/TabStrip.tsx` 가 남아 있는지 다시 확인한다.

---

## 끝난 뒤

설계 §9 가 적은 **"이번에 하지 않는 것"** 은 그대로 남는다. 다음 조각의 첫 질문은 둘이다.

1. **LLM 공급자** — §9 는 Kimi K3(OpenAI 호환), 실험은 Gemini 로 했고 ADR-0002 가 미결이다
2. **FROZEN 개봉 범위** — `shared/ipc.ts` 에 채널 몇 개를 더할지, `main/keys.ts` 의 "스텁 유지" 를 언제 만료시킬지

**탭 분할**(탭을 끌어 오른쪽 칸에 띄우기)은 별개 설계다. `tabs` + `activeTab` 모델 자체를 바꾸고, 그래프의 상시 마운트가 칸을 옮길 때 깨지는 문제를 함께 풀어야 한다.
