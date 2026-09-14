# PiecePool Desktop — 옵시디언식 좌측 크롬 — 설계

- 날짜: 2026-09-14
- 상태: 설계 승인됨 (구현 계획 대기)
- 상위 문서: `2026-09-05-electron-rebuild-design.md` — 재구축 전체 설계.
  이 문서는 그 11.3의 **8단계 첫 조각**만 다룬다. 이하 상위 문서의 절은 `상위 §12.3` 형식으로 인용한다.
- 선행: `feat: 창만 뜨는 electron 빈 셸을 붙인다` (7단계 일부 — 창·메뉴만)

## 1. 무엇을 만드나

옵시디언의 왼쪽 영역을 재현한다. 리본(좌측 아이콘 바)과 파일 탐색기 트리, 그리고 둘을 담는 3분할 셸이다.

본문 영역은 **선택된 파일명만 표시한다.** 에디터는 이 조각의 범위가 아니므로
별도 컴포넌트를 만들지 않고 `Shell.tsx` 안에 인라인으로 둔다.

## 2. 왜 지금인가 — 순서를 당기는 근거

상위 §11.1은 "UI는 v1의 목적이 아니다"라고 못 박았고 README 단계 표도 8단계를 마지막에 둔다.
그럼에도 지금 여는 근거는 하나다.

**README 역할표의 6인 중 3인이 UI/UX 담당이다.** 엔진 1~6단계가 끝날 때까지 그 인원이 만질 표면이 없다.
UI는 `renderer/`가 `core/`를 import할 수 없다는 경계(lint 강제) 덕분에 **엔진과 독립적으로 만들 수 있다** —
renderer 입장에서 실물 API와 목 데이터는 구분되지 않는다.

따라서 이 조각은 엔진 진행을 막지 않고, 1~6단계가 끝난 뒤 목을 IPC로 갈아끼우는 것으로 합류한다.

## 3. 결정 넷

| 항목    | 결정                      | 기각한 것                      | 근거                                   |
| ------- | ------------------------- | ------------------------------ | -------------------------------------- |
| 구 코드 | 참고만 하고 새로 작성     | `ds/components/` 직접 이식     | 상위 §12.3의 복사 배제를 지킨다        |
| 범위    | 접기·너비·토글·선택 넷    | 정적 모양만 / 리본 탭 전환까지 | "옵시디언 같다"가 성립하는 최소 집합   |
| 스타일  | Tailwind v4 + 구 토큰 CSS | 순수 CSS + 토큰                | 상위 §12.3의 `primitives/` 이식이 무상 |
| 테마    | `data-theme="dark"` 고정  | 라이트 고정 / 토글 제공        | 옵시디언 기본값, 추가 코드 0줄         |

### 3.1 "참고"와 "복사"의 경계

상위 §12.3은 `ds/primitives/`·`theme/`·`icons/`를 이식 대상으로, `ds/components/`와 `app/` 화면을
비대상으로 나눈다. 구 레포에는 `ds/components/{Sidebar,TreeNav}.tsx`와 `app/shell/{Ribbon,SidebarChrome}.tsx`가
이미 있고(631줄), 확인해 보면 배제 근거인 폐기 개념(`Concept`·`Subject`·관계 타입)에 묶여 있지 않다.

그럼에도 복사하지 않는다. 대신 경계를 이렇게 둔다.

- **상속한다** — 토큰 이름(`bg-chrome`·`border-hairline`·`text-ink-muted`). 이것이 "시각 언어"다
- **상속하지 않는다** — 드래그 리오더, 정렬 드롭다운 등. 옵시디언에 없거나 아직 필요 없다

### 3.2 Tailwind v4 를 고르는 값과 대가

구 `ds/primitives/*`는 Tailwind 클래스 문자열로 쓰여 있다(`"rounded-full bg-primary text-on-primary"`).
토큰 자체는 CSS 커스텀 프로퍼티라 Tailwind 없이도 쓸 수 있지만, 그 경우 상위 §12.3이 예정한
`primitives/` 이식 시점에 Tailwind를 그때 깔거나 primitives를 다시 짜야 한다.

대가는 ADR 없는 새 의존 2개(`tailwindcss`·`@tailwindcss/vite`)다. CLAUDE.md §9 표에 추가한다.

## 4. 파일 구조

```
vite.config.ts                    신규 — renderer 만 담당
src/renderer/
├─ index.html                     교체 — React 마운트 지점
├─ main.tsx                       main.ts 스텁을 대체. mount() 시그니처 유지
├─ styles/tokens.css              구 src/styles/index.css 344줄에서 발췌
├─ app/
│  ├─ Shell.tsx                   3분할 + 너비 드래그
│  ├─ Ribbon.tsx                  좌측 아이콘 바. 동작하는 것은 토글 하나뿐
│  ├─ Sidebar.tsx                 패널 헤더 + 트리 컨테이너
│  └─ FileTree.tsx                재귀 트리 · 접기 · 선택
└─ store/
   └─ workspace.ts                zustand
```

상위 §4.1의 `renderer/` 구성(`app/`·`features/`·`ds/`·`store/`)을 따르되,
`features/`와 `ds/`는 이번에 만들지 않는다 — 담을 것이 없다.

## 5. 상태

zustand 스토어 하나.

```ts
interface TreeNode {
  name: string;
  path: string; // 볼트 루트 기준. POSIX 구분자
  kind: "dir" | "file";
  children?: TreeNode[];
}

tree: TreeNode[]        // 목. 상위 §4.2 볼트 레이아웃 모양
expanded: Set<string>   // 펼친 폴더 경로
selected: string | null // 선택된 파일
sidebarOpen: boolean
sidebarWidth: number    // 드래그로 변경. 180~480 클램프
```

`TreeNode`는 **`shared/types.ts`에 넣지 않는다.** 지금은 목 전용이고,
진짜가 되는 순간 `shared/ipc.ts`의 응답 타입으로 태어나야 할 물건이다.
FROZEN 파일을 목 때문에 건드리지 않는다.

목 트리는 상위 §4.2의 볼트 레이아웃(`wiki/`·`inbox/`·`sources/`·`.piecepool/`)을 그대로 흉내낸다.
나중에 실물로 바뀔 때 모양이 달라지지 않게 하기 위해서다.

## 6. 렌더러를 띄우는 방법

현재 `main/index.ts`는 `loadFile(index.html)`이다. React는 번들이 필요하다.

`main`은 Electron이 `.ts`를 직접 실행하므로 번들할 것이 없다. 따라서 **vite는 renderer만** 담당한다.
electron-vite는 3타깃 빌드가 필요해지는 시점(패키징)까지 미룬다.

```
터미널 1   npm run dev     → vite (localhost:5173)
터미널 2   npm start       → electron → loadURL(localhost:5173)
```

`loadFile` 한 줄이 `loadURL`로 바뀐다. 프로덕션 빌드 경로(`out/renderer/`)는
**이번 범위 밖**이다 — 패키징을 시작할 때 electron-vite 도입과 함께 정한다.

터미널 둘을 하나로 합치려면 `concurrently` 같은 패키지가 필요한데, 그 값을 지금 치르지 않는다.

## 7. 설정 파일 손질

빠뜨리면 조용히 깨지는 것들이다.

| 파일                | 변경                                  | 빠뜨리면                                 |
| ------------------- | ------------------------------------- | ---------------------------------------- |
| `tsconfig.web.json` | `"jsx": "react-jsx"` 추가             | `.tsx` 가 통째로 타입 에러               |
| `eslint.config.js`  | `files: ["src/**/*.ts"]` → `{ts,tsx}` | **`.tsx` 가 경계 규칙 검사를 안 받는다** |

두 번째가 위험하다. 에러가 아니라 침묵이다 — `renderer/` → `core/` import 금지 같은 규칙이
새 `.tsx` 파일들에만 비활성된 채로 아무도 모르게 남는다. 첫 `.tsx`를 만드는 지금이 고칠 유일한 타이밍이다.

## 8. 통과 조건

- `npx prettier --check .` · `npm run lint` · `npm run typecheck` · `npm test` 전부 통과
- 창에서 네 동작 확인
  - 폴더 `▸`/`▾` 클릭으로 접고 펼치기
  - 사이드바 경계선 드래그로 너비 변경 (180~480 클램프)
  - 리본 아이콘으로 사이드바 접기/펼치기 (리본에서 동작하는 유일한 아이콘이다)
  - 파일 클릭 시 선택 하이라이트, 본문에 파일명 표시
- **모양이 옵시디언 같은지는 사람이 판단한다** (CLAUDE.md §7)

## 9. 범위 밖

IPC · preload · 실제 볼트 읽기 · 리본 탭 전환(검색·북마크) · 우클릭 메뉴 · 새 노트 만들기 ·
`ds/primitives` 이식 · 프로덕션 빌드 · 패키징 · 에디터(CodeMirror) · 그래프 뷰

## 10. 따라오는 문서 작업

| 무엇                                            | 왜                            |
| ----------------------------------------------- | ----------------------------- |
| CLAUDE.md §1 "renderer 는 8단계까지 스텁 유지"  | 단계가 넘어가 만료된다        |
| CLAUDE.md §9 표에 Tailwind v4 추가              | 새 라이브러리 결정            |
| CLAUDE.md §4 에 ESM 엔트리 top-level await 금지 | 타입은 통과하는데 창이 죽는다 |
