# 프레임리스 창 크롬 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OS 타이틀바를 없애 리본 토글 버튼이 창 맨 위에서 시작하게 하고, 창 조작과 드래그를 앱이 직접 맡는다.

**Architecture:** 창 생성이 플랫폼으로 갈린다 — Windows·Linux 는 `frame: false` 로 프레임을 통째로 없애고 버튼 셋을 우리가 그리고, macOS 는 `titleBarStyle: "hidden"` 으로 바만 숨겨 OS 신호등을 남긴다. 창 조작은 돌려줄 값이 없는 단방향이라 `ipcMain.on`/`ipcRenderer.send` 를 쓴다(`wrap()` 을 쓰지 않는다). 창 맨 위 32px 띠가 드래그 영역이고, 그 위에 얹히는 클릭 대상만 `no-drag` 로 되돌린다.

**Tech Stack:** Electron 44 · React · zustand · Tailwind v4 · vite · vitest (node)

**설계문서:** `docs/superpowers/specs/2026-09-15-frameless-chrome-design.md`

## Global Constraints

모든 태스크에 적용된다.

- **`.ts`/`.tsx` 확장자를 import 에 반드시 붙인다.** `node` 가 `.ts` 를 직접 실행하므로 확장자를 추론하지 않는다
- **`enum`·`namespace`·생성자 파라미터 프로퍼티 금지** (lint 가 잡는다)
- **`src/shared/types.ts` 는 FROZEN.** 읽고 import 만 한다. **한 줄도 고치지 않는다**
- **`src/shared/ipc.ts` 도 FROZEN 이다.** 이 계획은 **Task 1 에서만** 이 파일을 고친다. 설계 §3.1 에 적힌 합의 범위(채널 셋 + `isMac`)를 벗어나면 멈추고 묻는다
- **`src/core/` 는 `electron` 을 import 할 수 없다** (lint 가 잡는다). `src/core/` 는 이 계획에서 **한 파일도 건드리지 않는다**
- **`src/renderer/` 는 `core/`·`main/`·`cli/` 를 import 할 수 없다** (lint 가 잡는다). `shared/` 는 가능하다
- **`src/shared/` 는 `node:*`·`electron`·`window`·`document` 를 쓸 수 없다.** 타입과 순수 상수만 — `CHANNEL` 에 문자열을 더하는 것은 순수 상수다
- **요청하지 않은 `unimplemented` 스텁을 채우지 않는다.** `src/main/keys.ts` 의 셋은 그대로 둔다
- **DOM 테스트를 만들지 않는다.** `vitest.config.ts` 는 `environment: "node"`, `include: ["src/**/*.test.ts"]` 다
- **이 계획은 테스트를 늘리지 않는다. 시작도 끝도 31개 / 5파일이다.** 창 조작도 드래그도 OS 경계라 `environment: "node"` 가 닿지 않는다 (설계 §6)
- **매 커밋 전 `npx prettier --write .` 을 돌린다.** CI 가 `--check` 로 돈다
- **커밋 메시지**는 Conventional Commits, 타입은 영어 설명은 한국어. 끝에 두 줄을 **문자 그대로** 붙인다

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012JaHYUbJEzRicYDA3Z6HTS
  ```

- **브랜치는 `feat/electron-shell`.** 앞 조각("실제 볼트 열기")에 이어 붙인다. `main` 에 직접 커밋하지 않는다
- **앱을 띄워 확인하는 절차**(Task 1·3 에 나온다)는 매번 같다:
  1. `tasklist | grep -ci electron.exe` 가 0인지 확인하고, 아니면 죽인다
  2. 백그라운드로 `npm run dev` — 출력을 파일에 남긴다
  3. 백그라운드로 `npm start` — 출력을 파일에 남긴다
  4. `tasklist | grep -ci electron.exe` 가 **4 근처**인지 확인한다 (1이면 렌더러가 못 떴다)
  5. main 출력에서 `Unable to load preload script` 를 grep 한다. **나오면 실패다**
  6. 둘 다 죽이고 0으로 돌아오는지 확인한다. **vite 는 셸을 죽여도 자식 node 가 5173 을 계속 잡고 있을 수 있다** — `netstat -ano | grep ':5173 '` 로 LISTENING 이 남았는지 보고, 남았으면 그 PID 만 `taskkill //F //PID <pid>` 로 죽인다. `node.exe` 를 통째로 죽이지 않는다

## 파일 구조

| 파일                                         | 책임                                              | 태스크 |
| -------------------------------------------- | ------------------------------------------------- | ------ |
| `src/shared/ipc.ts`                          | 채널 문자열과 `PiecePoolApi` 계약                 | 1      |
| `src/preload/index.ts`                       | 화이트리스트. renderer 가 만나는 유일한 창구      | 1      |
| `src/main/ipc.ts`                            | 창 조작 핸들러                                    | 1      |
| `src/renderer/bridge.ts` (신규)              | preload 부재를 흡수한다. renderer 의 방어선 한 곳 | 2      |
| `src/renderer/app/WindowControls.tsx` (신규) | 최소화·최대화·닫기 버튼 셋                        | 2      |
| `src/renderer/styles/tokens.css`             | `.app-drag` · `.app-no-drag` 유틸리티             | 2      |
| `src/renderer/app/Shell.tsx`                 | 드래그 띠 배치와 z 순서                           | 2·3    |
| `src/renderer/app/Ribbon.tsx`                | 버튼 `no-drag`, macOS 상단 여백                   | 3      |
| `src/main/index.ts`                          | 창 생성의 플랫폼 분기                             | 3      |

**태스크 순서의 이유:** 프레임 제거(Task 3)를 마지막에 둔다. Task 2 가 끝나면 타이틀바와 우리 버튼이 **둘 다** 보이는데, 그 상태에서 버튼 셋이 실제로 동작하는지 확인할 수 있다 — 되돌릴 길(OS 타이틀바)이 남아 있는 채로. 프레임을 먼저 없애면 버튼이 없는 동안 창을 닫을 방법이 Alt+F4 뿐이다.

## 설계에서 벗어난 곳 둘

계획을 쓰면서 설계문서와 다르게 정한 것이다. **리뷰에서 이것을 "빠뜨림" 으로 세지 않는다.**

1. **macOS 신호등을 옮기지 않는다.** 설계 §2.1 은 `trafficLightPosition` 으로 신호등을 내려 앉힌다고 했다.
   실제로 내려 앉히면 신호등(폭 약 70px)이 리본(48px)을 넘어 사이드바까지 덮는다 — 겹침을 옮길 뿐 없애지 못한다.
   대신 **리본의 첫 버튼을 신호등 아래로 내린다**(Task 3 Step 3 의 `pt-10`). 신호등은 기본 위치에 둔다.
2. **사이드바 헤더를 `no-drag` 로 만들지 않는다.** 설계 §4 의 목록에 들어 있지만, 그 목록의 목적은
   "클릭이 계속 먹어야 하는 것" 이다. 헤더는 볼트 이름 **텍스트**뿐이라 `no-drag` 로 만들면 끌 수 있는 면적만 줄어든다.

## 이 계획이 하지 않는 것

- `src/renderer/store/workspace.ts` 는 `window.piecepool` 을 직접 부르고 `call()` 로 부재를 흡수한다. **Task 2 의 `bridge.ts` 로 옮기지 않는다** — 동작이 같고 지나가다 하는 재구조화다. 남은 불일치는 다음 조각의 몫이다
- 최대화 상태에 따른 아이콘 교체 (설계 §2.2)
- 창 크기·위치 기억, 타이틀 텍스트 표시, Linux 고유 관례 (설계 §5)

---

### Task 1: 창 조작 IPC 셋

계약·preload·핸들러를 한 번에 놓는다. 아직 부르는 화면이 없어 보이는 변화는 없다.

**Files:**

- Modify: `src/shared/ipc.ts` (FROZEN — 합의된 범위만)
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc.ts`

**Interfaces:**

- Consumes: 기존 `CHANNEL`·`PiecePoolApi`·`wrap()`
- Produces:
  - `CHANNEL.windowMinimize = "window:minimize"` · `CHANNEL.windowToggleMaximize = "window:toggleMaximize"` · `CHANNEL.windowClose = "window:close"`
  - `PiecePoolApi` 에 `minimizeWindow(): void` · `toggleMaximizeWindow(): void` · `closeWindow(): void` · `isMac: boolean`

- [ ] **Step 1: `src/shared/ipc.ts` 의 `CHANNEL` 에 셋을 더한다**

기존 두 줄은 그대로 두고 아래에 셋을 넣는다. 첫 줄의 `// FROZEN:` 마커는 **건드리지 않는다.**

```ts
/** 채널명. 문자열을 양쪽에 각각 적으면 오타가 런타임까지 간다. */
export const CHANNEL = {
  vaultPick: "vault:pick",
  vaultLast: "vault:last",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggleMaximize",
  windowClose: "window:close",
} as const;
```

- [ ] **Step 2: `PiecePoolApi` 에 넷을 더한다**

기존 두 줄은 그대로 두고 아래에 넣는다.

```ts
/**
 * preload 가 renderer 에 열어 주는 전부다.
 * 여기 없는 것은 화면에서 부를 수 없다 — 이 인터페이스가 곧 공격 표면의 목록이다.
 */
export interface PiecePoolApi {
  pickVault: () => Promise<Result<VaultPayload | null>>;
  lastVault: () => Promise<Result<VaultPayload | null>>;
  /** 창 조작. 돌려줄 값이 없어 단방향이다 — Result 로 감싸지 않는다. */
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;
  /** macOS 는 창 조작 버튼을 OS 가 그린다. 우리 버튼을 그리면 둘 다 뜬다. */
  isMac: boolean;
}
```

- [ ] **Step 3: `src/preload/index.ts` 가 넷을 노출한다**

`api` 객체만 바꾼다. 파일의 주석과 `exposeApi()` 호출은 그대로 둔다.

```ts
export function exposeApi(): void {
  const api: PiecePoolApi = {
    pickVault: () => ipcRenderer.invoke(CHANNEL.vaultPick),
    lastVault: () => ipcRenderer.invoke(CHANNEL.vaultLast),
    minimizeWindow: () => ipcRenderer.send(CHANNEL.windowMinimize),
    toggleMaximizeWindow: () => ipcRenderer.send(CHANNEL.windowToggleMaximize),
    closeWindow: () => ipcRenderer.send(CHANNEL.windowClose),
    // 샌드박스 preload 에서도 process.platform 은 Electron 이 채워 준다.
    isMac: process.platform === "darwin",
  };
  contextBridge.exposeInMainWorld("piecepool", api);
}
```

- [ ] **Step 4: `src/main/ipc.ts` 의 import 에 둘을 더한다**

`BrowserWindow` 는 값으로, `IpcMainEvent` 는 타입으로 가져온다.

```ts
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { IpcMainEvent } from "electron";
```

- [ ] **Step 5: 요청한 창을 찾는 함수를 더한다**

`registerHandlers` **앞**에 둔다. 기존 `stateFile()`·`open()` 은 한 줄도 고치지 않는다.

```ts
/**
 * 요청을 보낸 창을 이벤트에서 찾는다.
 * 모듈 변수로 쥐면 창이 여럿이 될 때 엉뚱한 창을 닫는다 — 조용히 틀리는 자리다.
 */
function senderWindow(e: IpcMainEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}
```

- [ ] **Step 6: `registerHandlers` 에 창 조작 셋을 등록한다**

기존 `ipcMain.handle` 둘은 그대로 두고, 함수 끝에 셋을 더한다. 함수 위 주석도 사실에 맞게 고친다.

```ts
/** vault 둘과 창 조작 셋을 등록한다. 창 조작은 돌려줄 값이 없어 단방향이다. */
export function registerHandlers(): void {
```

`ipcMain.handle(CHANNEL.vaultLast, ...)` 블록 **다음**, 함수 닫는 괄호 **앞**에 넣는다.

```ts
// invoke 가 아니라 on 이다 — 돌려줄 값이 없다는 것을 API 선택으로 드러낸다.
ipcMain.on(CHANNEL.windowMinimize, (e) => senderWindow(e)?.minimize());

ipcMain.on(CHANNEL.windowToggleMaximize, (e) => {
  const win = senderWindow(e);
  if (win === null) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});

ipcMain.on(CHANNEL.windowClose, (e) => senderWindow(e)?.close());
```

- [ ] **Step 7: 정적 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **31개 / 5파일** 그대로

- [ ] **Step 8: 앱이 여전히 뜨는지 확인**

Global Constraints 의 "앱을 띄워 확인하는 절차" 를 그대로 돌린다.
아직 부르는 화면이 없으므로 **보이는 변화는 없다.** 프로세스가 4 근처이고 `Unable to load preload script` 가 없으면 통과다.
관찰한 숫자와 문자열을 그대로 보고한다.

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: 창 조작 IPC 셋을 연다"
```

---

### Task 2: 창 조작 버튼을 그린다

버튼이 생긴다. **타이틀바는 아직 있다** — 그래서 되돌릴 길이 남은 채로 버튼 셋이 실제로 동작하는지 확인할 수 있다.

**Files:**

- Create: `src/renderer/bridge.ts`
- Create: `src/renderer/app/WindowControls.tsx`
- Modify: `src/renderer/styles/tokens.css`
- Modify: `src/renderer/app/Shell.tsx`

**Interfaces:**

- Consumes: `PiecePoolApi` (`src/shared/ipc.ts`, Task 1)
- Produces:
  - `bridge.ts` — `export const bridge: PiecePoolApi | undefined` · `export const IS_MAC: boolean`
  - `WindowControls()` — props 없음. macOS 에서는 `null` 을 돌려준다

- [ ] **Step 1: `src/renderer/bridge.ts` 생성**

```ts
import type { PiecePoolApi } from "../shared/ipc.ts";

/**
 * preload 가 안 붙은 경우를 흡수한다.
 *
 * `npm start` 대신 `electron .` 을 직접 치거나, `npm run dev` 만 켜고
 * 일반 브라우저로 localhost:5173 을 열면 `window.piecepool` 이 없다.
 * 타입은 "항상 있다" 고 말하므로(piecepool.d.ts) 여기서만 거짓말을 되돌린다 —
 * 렌더 중에 읽다가 throw 하면 화면 전체가 하얗게 죽는다.
 */
export const bridge = window.piecepool as PiecePoolApi | undefined;

export const IS_MAC = bridge?.isMac ?? false;
```

- [ ] **Step 2: `tokens.css` 에 드래그 유틸리티를 더한다**

파일 **맨 끝**(`@layer base { ... }` 블록 다음)에 붙인다.

```css
/* 프레임리스 창의 드래그 영역.
   Tailwind 에 대응 유틸리티가 없고, React 의 CSSProperties 에
   -webkit-app-region 이 없어 인라인 style 은 캐스트를 요구한다. */
.app-drag {
  -webkit-app-region: drag;
}

.app-no-drag {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 3: `src/renderer/app/WindowControls.tsx` 생성**

```tsx
import { bridge, IS_MAC } from "../bridge.ts";

const BTN = "app-no-drag grid h-8 w-11 place-items-center text-ink-muted hover:text-ink";

/**
 * 최소화·최대화·닫기.
 *
 * macOS 에서는 그리지 않는다 — OS 신호등이 이미 왼쪽 위에 있어 둘 다 뜬다.
 * preload 가 없으면 부를 대상이 없으므로 역시 그리지 않는다.
 */
export function WindowControls() {
  if (bridge === undefined || IS_MAC) return null;

  return (
    <div className="absolute right-0 top-0 z-20 flex">
      <button
        type="button"
        onClick={() => bridge.minimizeWindow()}
        aria-label="최소화"
        className={`${BTN} hover:bg-fill-subtle`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
          <line x1="1" y1="5" x2="9" y2="5" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => bridge.toggleMaximizeWindow()}
        aria-label="최대화"
        className={`${BTN} hover:bg-fill-subtle`}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        >
          <rect x="1.5" y="1.5" width="7" height="7" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => bridge.closeWindow()}
        aria-label="닫기"
        className={`${BTN} hover:bg-danger hover:text-on-primary`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 4: `Shell.tsx` 가 버튼을 그린다**

import 에 한 줄을 더한다.

```tsx
import { WindowControls } from "./WindowControls.tsx";
```

`Shell` 의 반환 JSX 에서 바깥 `div` 에 `relative` 를 더하고 `<WindowControls />` 를 첫 자식으로 넣는다. 나머지 자식은 그대로 둔다.

```tsx
return (
  <div className="relative flex h-full bg-canvas text-ink">
    <WindowControls />
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
```

- [ ] **Step 5: 정적 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **31개 / 5파일** 그대로

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: 창 조작 버튼 셋을 그린다"
```

- [ ] **Step 7: 사람에게 넘길 것을 보고서에 적는다**

앱을 띄우지 않는다. 대신 보고서에 **사람 확인 필요** 로 다음을 적는다 — 이 시점에는 타이틀바가 아직 있어 버튼이 두 벌 보이는 것이 정상이다.

- 오른쪽 위에 우리 버튼 셋이 보이나
- 최소화·최대화·닫기가 각각 동작하나
- 최대화 버튼을 두 번 누르면 원래 크기로 돌아오나

---

### Task 3: 프레임을 없애고 드래그 띠를 단다

**Files:**

- Modify: `src/main/index.ts`
- Modify: `src/renderer/app/Shell.tsx`
- Modify: `src/renderer/app/Ribbon.tsx`

**Interfaces:**

- Consumes: `bridge.ts` 의 `IS_MAC` (Task 2), `.app-drag`·`.app-no-drag` (Task 2)
- Produces: 없음

- [ ] **Step 1: 창 생성이 플랫폼으로 갈린다**

`src/main/index.ts` 의 `DEV_URL` 선언 **다음**에 상수를 하나 둔다.

```ts
// 창 조작 관례가 정반대다 — Windows 는 오른쪽 위 세 버튼, macOS 는 왼쪽 위 신호등.
// macOS 에서 frame:false 를 쓰면 그 신호등까지 사라진다.
const IS_MAC = process.platform === "darwin";
```

`createWindow` 의 `new BrowserWindow({ ... })` 에서 `height: 800,` 다음 줄에 한 줄을 넣는다. `webPreferences` 블록은 그대로 둔다.

```ts
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    // 타이틀바를 없앤다. macOS 만 hidden 으로 — 바만 숨기고 신호등은 남긴다.
    ...(IS_MAC ? { titleBarStyle: "hidden" as const } : { frame: false }),
    webPreferences: {
```

- [ ] **Step 2: `Shell.tsx` 에 드래그 띠를 넣는다**

`<WindowControls />` **앞**에 띠를 넣고, `Ribbon` 과 사이드바 묶음을 `z-10` 위로 올린다.

`z` 순서가 필요한 이유: 띠는 `absolute` 라 아무 z 지정이 없으면 정적 형제들보다 **위에** 그려져서, 그 아래 버튼이 DOM 클릭을 못 받는다.

`Ribbon` 만 위로 올린다(Step 3). 사이드바와 `main` 은 올리지 않는다 — 띠는 높이가 32px 뿐이고, 사이드바에서 클릭할 것(트리 행·전환기)은 전부 그 아래에서 시작한다. `main` 위에서는 오히려 띠가 덮는 편이 낫다(끌 수 있는 면적이 넓어진다).

```tsx
return (
  <div className="relative flex h-full bg-canvas text-ink">
    {/* 창을 끌 수 있는 유일한 자리. 위에 얹히는 클릭 대상은 app-no-drag 로 되돌린다. */}
    <div className="app-drag absolute inset-x-0 top-0 z-0 h-8" />
    <WindowControls />
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
```

- [ ] **Step 3: `Ribbon.tsx` 의 버튼을 드래그에서 빼낸다**

**이 조각에서 가장 조용히 깨지는 자리다**(설계 §4.1). 리본 버튼은 창 맨 위 32px 안에 있어 `no-drag` 가 없으면 **클릭이 아예 안 먹는다.** 화면상으로는 멀쩡하고 콘솔 경고도 없다.

import 에 `IS_MAC` 을 더한다.

```tsx
import { IS_MAC } from "../bridge.ts";
import { RIBBON_WIDTH, useWorkspace } from "../store/workspace.ts";
```

`nav` 와 `button` 의 `className` 을 바꾼다. 나머지(SVG 포함)는 그대로 둔다.

```tsx
    <nav
      aria-label="리본"
      style={{ width: RIBBON_WIDTH }}
      className={`relative z-10 flex shrink-0 flex-col items-center gap-1 border-r border-hairline bg-chrome ${
        // macOS 는 왼쪽 위에 OS 신호등이 있다. 첫 버튼을 그 아래로 내린다.
        IS_MAC ? "pt-10" : "pt-2"
      }`}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
        className="app-no-drag grid h-8 w-8 place-items-center rounded text-ink-muted hover:bg-fill-subtle hover:text-ink"
      >
```

- [ ] **Step 4: `Sidebar.tsx` 를 고치지 않는다는 것을 확인한다**

사이드바 헤더(`h-9`)는 띠와 겹치지만 **클릭 대상이 아니다** — 볼트 이름 텍스트뿐이다.
드래그 영역으로 남겨 두는 것이 맞다(끌 수 있는 면적이 넓어진다). 파일 트리는 `y=36` 아래에서 시작해 띠와 겹치지 않는다.

**`Sidebar.tsx` 를 열어 헤더 아래에 클릭 가능한 요소가 없는지 확인만 하고, 고치지 않는다.**
있으면 고치지 말고 보고하라.

- [ ] **Step 5: 정적 검사**

Run: `npx prettier --write . && npm run lint && npm run typecheck && npm test`
Expected: 넷 다 통과, 테스트 **31개 / 5파일** 그대로

- [ ] **Step 6: 앱이 뜨는지 확인**

Global Constraints 의 "앱을 띄워 확인하는 절차" 를 그대로 돌린다.
프로세스가 4 근처이고 `Unable to load preload script` 가 없으면 여기까지 통과다.

**화면의 모양·클릭·드래그는 네가 판단할 수 없다.** 보고서에 **사람 확인 필요** 로 분리해 적는다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 타이틀바를 없애고 상단 띠로 창을 끈다"
```

---

## 통과 조건 (전체)

- `npx prettier --check .` · `npm run lint` · `npm run typecheck` · `npm test` 전부 통과
- 테스트 **31개 / 5파일** (이 계획은 테스트를 늘리지 않는다)
- main 출력에 `Unable to load preload script` 가 없다

**사람이 확인할 것** — 에이전트가 할 수 없다 (설계 §6):

- 리본 토글 버튼이 창 맨 위에서 시작하나 (타이틀바가 사라졌나)
- 리본 토글 버튼이 **눌리나** (설계 §4.1 — 이게 실패하면 화면상으로는 아무 표시가 없다)
- 상단 띠의 빈 곳을 잡아 창이 움직이나
- 사이드바를 접은 상태에서도 창이 움직이나
- 최소화·최대화·닫기 세 버튼이 각각 동작하나
- 상단 띠를 더블클릭하면 최대화되나
- **창 가장자리를 끌어 크기가 바뀌나** — 프레임리스 창이 리사이즈 핸들을 잃는 경우가 있다
- 볼트를 연 상태에서 사이드바 헤더(볼트 이름)를 잡아도 창이 움직이나

## 범위 밖

최대화 상태 아이콘 교체 · 창 크기·위치 기억 · 타이틀 텍스트 표시 · 탭 ·
Linux 고유 창 조작 관례 · `workspace.ts` 를 `bridge.ts` 로 옮기기 · CSP · 패키징
