# PiecePool Desktop — 탭 분할(드래그) — 설계

- 날짜: 2026-09-16
- 상태: 설계 승인됨 (구현 계획 대기)
- 상위 문서: `2026-09-05-electron-rebuild-design.md` — 재구축 전체 설계. 이 문서는 그 **8단계(UI)** 의 창 크롬 조각이다.
- 선행: `2026-09-15-tabs-and-wiki-read-design.md`(탭 union) · `2026-09-16-graph-view-design.md`(그래프 마운트) · `2026-09-16-query-tab-shell-design.md`(쿼리 탭)
- 이 조각을 부른 것: 쿼리 탭 설계 §9 가 "탭 분할은 별개 조각" 으로 미뤄 둔 자리다

## 1. 무엇을 만드나

탭을 잡아 오른쪽으로 끌면 화면이 **좌/우 두 칸**으로 갈라지고 그 탭이 오른쪽 칸으로 간다.
칸이 이미 둘이면 끌어서 칸 사이를 오간다. 한 칸이 비면 칸이 도로 하나가 된다.

노트를 왼쪽에 띄우고 오른쪽에서 쿼리하는 것이 이 기능의 쓰임새다.

## 2. 결정 여덟

| 항목            | 결정                                           | 기각한 것                 | 근거                                                            |
| --------------- | ---------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| 칸 수           | **좌/우 둘 고정**                              | N칸 · 중첩 분할           | 중첩은 모델이 트리가 되고 비율 재배분이 따라온다                |
| 칸 너비         | **50/50 고정**                                 | 끌어서 조절               | `paneRatio` 상태·클램프·키보드 접근성이 통째로 따라온다         |
| 드래그 기법     | **포인터 이벤트**                              | HTML5 DnD                 | 탭 줄이 OS 드래그 띠 위다 (§3)                                  |
| 그래프 배치     | **칸을 옮기면 잃는다**                         | 좌표·시점 이관            | `GraphView.tsx` 를 한 줄도 안 건드린다 (§7)                     |
| 재정렬          | **없다**                                       | 같은 칸 안 탭 순서 바꾸기 | 요청에 없다. 삽입 위치 계산과 표시가 따로 붙는다                |
| 같은 노트 중복  | **금지** — 어느 칸에든 있으면 그 칸으로 포커스 | 양쪽 칸에 동시에          | 지금 `openTab` 의 "이미 열려 있으면 다시 읽지 않는다" 를 잇는다 |
| 새 탭이 열릴 칸 | **`activePane`** — 마지막으로 만진 칸          | 항상 왼쪽                 | 오른쪽에서 작업하다 노트를 열면 엉뚱한 칸에 뜬다                |
| 드래그 상태     | **자기만의 작은 스토어**                       | `workspace` 스토어에 함께 | 포인터마다 `set` 이 돌면 화면 전체가 리렌더된다 (§6)            |

## 3. 왜 포인터 이벤트인가

이 레포는 프레임리스 창의 드래그 띠에 **세 번 데였다** — `2b7e204`(띠 도입) → `1c727be` → `1cea9d8`.
`Shell.tsx` 의 주석이 그 교훈을 그대로 적어 뒀다.

> no-drag 는 OS 드래그 영역에서만 빼 준다 — 띠는 absolute 라 페인트 순서상 정적 형제보다
> 위에 있어서, z 가 없으면 pointerdown 을 띠가 받아 아무 일도 안 일어난다.

탭 줄은 바로 그 띠 위에 얹혀 있고, `TabStrip` 의 빈 공간은 **일부러** 창 끄는 자리로 남겨 뒀다.
HTML5 드래그 앤 드롭을 여기 도입하면 OS 창 드래그와 브라우저 드래그가 같은 픽셀에서 경합한다.

포인터 이벤트는 이 레포에 이미 두 벌 있다 — `ResizeHandle` 의 `setPointerCapture`,
`GraphView` 의 `CLICK_SLOP = 3`("이만큼 안 움직이면 드래그가 아니라 클릭이다").
**같은 관용구를 세 번째로 쓰는 것**이다.

## 4. 스토어 모델 — 이 조각의 핵심 변경

```ts
/** 칸 하나. 탭 줄과 본문이 한 벌이다. */
export interface Pane {
  tabs: Tab[];
  activeTab: string | null;
}

// WorkspaceState
panes: Pane[];      // 길이 1 또는 2. 그 이상은 어떤 액션도 만들지 않는다
activePane: number; // 0 또는 1 — 새 탭이 열릴 칸
```

최상위 `tabs` · `activeTab` 이 **사라진다.** 그래서 기존 액션 다섯이 전부 바뀐다.

| 액션                          | 바뀌는 점                                                                 |
| ----------------------------- | ------------------------------------------------------------------------- |
| `openTab`                     | **어느 칸에든** 이미 있으면 그 칸으로 포커스, 없으면 `activePane` 에 연다 |
| `openGraphTab`·`openQueryTab` | 같다                                                                      |
| `focusTab(id)`                | 탭이 든 칸을 찾아 그 칸의 `activeTab` 과 `activePane` 을 함께 옮긴다      |
| `closeTab(id)`                | 칸을 찾아 지운다. 칸이 비면 칸 자체를 없앤다                              |
| `applied()`                   | `panes: [{ tabs: [], activeTab: null }]` · `activePane: 0`                |

새 액션은 **하나뿐**이다.

```ts
/**
 * 드롭이 확정됐을 때. `to` 가 `panes.length` 면 칸을 새로 만든다 —
 * 분할과 이동이 한 함수다. 같은 칸으로의 드롭은 아무 일도 하지 않는다.
 */
moveTabToPane: (id: string, to: number) => void;
```

떠난 칸의 `activeTab` 은 `closeTab` 과 **같은 규칙**으로 고른다 — 오른쪽 이웃, 없으면 왼쪽.
옮겨간 탭은 받는 칸에서 활성이 되고, `activePane` 은 받는 칸이 된다.

### 4.1 빈 칸 정리는 순수 함수로 뺀다

칸을 지우면 **인덱스가 밀린다.** 칸 하나뿐인 상태에서 그 탭을 오른쪽으로 끌면
새 칸(1)이 생기고 칸 0이 비는데, 0을 지우면 새 칸이 인덱스 0으로 내려온다.
`moveTabToPane` 과 `closeTab` 이 이 계산을 각자 하면 한쪽만 틀린다.

```ts
// src/renderer/store/panes.ts
/** 빈 칸을 걷어내고, 주목할 칸의 새 인덱스를 함께 돌려준다. focus 칸이 비었으면 0 이다. */
export function compact(panes: Pane[], focus: number): { panes: Pane[]; activePane: number };
```

칸이 전부 비면 **빈 칸 하나를 남긴다.** `panes` 는 절대 빈 배열이 되지 않는다 —
`panes[0]` 을 읽는 자리가 여럿이고, 빈 배열을 허용하면 그 전부에 가드가 붙는다.

## 5. 드롭 존 — 순수 함수

```ts
// src/renderer/features/split/hit.ts
export interface DropArea {
  left: number;
  width: number;
}

/** 포인터 x 가 어느 칸으로의 드롭인지. null 이면 제자리다(아무 일도 안 일어난다). */
export function hitDropZone(x: number, area: DropArea, paneCount: number): number | null;
```

- **칸이 하나일 때** — 오른쪽 25% 안이면 `1`(분할), 아니면 `null`
- **칸이 둘일 때** — 가운데(50%) 왼쪽이면 `0`, 오른쪽이면 `1`

```
칸 1개                          칸 2개
┌──────────────┬─────┐         ┌─────────┬─────────┐
│     null     │  1  │         │    0    │    1    │
└──────────────┴─────┘         └─────────┴─────────┘
               75%                       50%
```

`features/graph/hit.ts`(캔버스 좌표 → 노드)와 같은 자리다. **드래그에서 가장 틀리기 쉬운 부분이
판정이고, 판정만큼은 자동 검증된다** — `.tsx` 는 테스트할 수 없기 때문에 더 그렇다.

`DropArea` 는 드래그 시작 시 본문 영역의 `getBoundingClientRect()` 로 한 번 재서 들고 있는다.
드래그 중에 창 크기가 바뀌는 경우는 다루지 않는다.

## 6. 드래그 상태는 따로 산다

```ts
// src/renderer/features/split/drag.ts
interface DragState {
  /** 끌고 있는 탭. null 이면 드래그 중이 아니다. */
  tab: { id: string; title: string } | null;
  x: number;
  y: number;
  area: DropArea | null;
  /** 지금 떨구면 갈 칸. null 이면 제자리다. */
  zone: number | null;
  start: (tab: { id: string; title: string }, area: DropArea) => void;
  move: (x: number, y: number, paneCount: number) => void;
  end: () => void;
}
```

`workspace` 스토어에 넣지 않는 이유는 둘이다.

1. **리렌더.** 포인터가 움직일 때마다 `workspace.set` 이 돌면 `Sidebar`·`Pane` 둘·`Ribbon` 이 전부
   다시 그려진다. 이 스토어는 구독자가 `DragLayer` 하나뿐이라 고스트 div 만 다시 그려진다
2. **경계.** `applied()`(볼트 전환)나 `closeTab` 이 드래그를 몰라도 된다

`DragLayer` 는 `Shell` 이 그리는 오버레이다. `pointer-events-none` 이라 아래 요소의 포인터
이벤트를 가로채지 않는다. 그리는 것은 둘 — 포인터를 따라다니는 반투명 탭 모양과,
`zone` 이 가리키는 칸의 테두리 강조다.

## 7. 그래프가 깨지는 자리와 안 깨지는 자리

| 동작                                    | 결과                                             |
| --------------------------------------- | ------------------------------------------------ |
| 칸을 나눈다 (그래프는 왼쪽에 그대로)    | **멀쩡하다.** 인스턴스가 옮겨가지 않는다         |
| 왼쪽 칸에서 다른 탭으로 갔다가 돌아온다 | **멀쩡하다.** 지금의 `hidden` 수법이 그대로 산다 |
| **그래프 탭을 오른쪽 칸으로 끈다**      | **배치를 잃는다.** 의도한 대로다                 |

`GraphView` 는 배치·pan/zoom·시뮬레이션을 컴포넌트 안 `useRef` 에 든다. ref 는 인스턴스에
묶이므로 칸을 옮기면 언마운트→새 인스턴스가 되고 배치가 사라진다. 이것을 받아들인 이유:

- **의도적으로 한 번 하는 행동이다.** 커밋 `1216511` 이 고친 것은 "탭을 바꿀 때마다" 였고, 빈도가 다르다
- 재배치는 수백 ms 이고, `새로고침` 버튼이 이미 화면에 있다
- 막으려면 `GraphView` 내부를 열어야 하는데 `.tsx` 라 자동 테스트가 없다

`NoteView` 는 `graphOpen` 을 **자기 칸의 탭 기준으로** 판단하도록 바꾼다.

## 8. 파일 배치

```
src/renderer/app/
  Shell.tsx        칸 둘 배치 + DragLayer 마운트        (수정)
  Pane.tsx         탭줄 + 본문 한 벌                    (새 파일)
  TabStrip.tsx     pane 을 받는다 + 포인터 핸들러        (수정)
  NoteView.tsx     pane 을 받는다                       (수정)

src/renderer/store/
  workspace.ts     panes · activePane · moveTabToPane   (수정)
  panes.ts         compact — 순수                       (새 파일)
  panes.test.ts                                         (새 파일)

src/renderer/features/split/
  hit.ts           hitDropZone — 순수                   (새 파일)
  hit.test.ts                                           (새 파일)
  drag.ts          드래그 전용 스토어                    (새 파일)
  DragLayer.tsx    고스트 + 드롭 존 강조                 (새 파일)
```

`Pane.tsx` 가 새로 생기는 이유: 지금 `Shell` 이 `<TabStrip/>` 과 `<NoteView/>` 를 직접 나란히
놓는데, 칸이 둘이 되면 그 한 벌을 두 번 그려야 한다. 복제하지 않고 부품으로 묶는다.

`compact` 를 `store/panes.ts` 에 두는 이유: `workspace.ts` 가 이미 240줄이고, 칸 계산이 들어오면
더 는다. 순수 함수는 테스트가 붙으므로 따로 두는 편이 읽기도 검증하기도 낫다.

## 9. 드래그의 순서

1. 탭 제목 버튼에서 `onPointerDown` — `setPointerCapture`, 시작 좌표를 기록한다. **아직 드래그가 아니다**
2. `onPointerMove` — 시작점에서 `CLICK_SLOP`(3px)을 넘으면 그때 `drag.start()` 를 부른다.
   이후 매 이동마다 `drag.move(x, y, paneCount)` 가 `hitDropZone` 으로 `zone` 을 갱신한다
3. `onPointerUp` —
   - 드래그가 시작되지 않았으면 **클릭이다.** `focusTab(id)` 를 부른다
   - 드래그 중이면 `zone` 이 `null` 이 아닐 때만 `moveTabToPane(id, zone)` 을 부른다
   - 어느 쪽이든 `drag.end()` 와 `releasePointerCapture`
4. `onPointerCancel` — `drag.end()` 만. **아무것도 옮기지 않는다**

`ResizeHandle` 이 이미 겪은 함정이 하나 있다: `releasePointerCapture` 는 `pointerCancel` 상황에서
`NotFoundError` 를 던질 수 있다. 상태를 먼저 되돌리고 해제를 나중에 한다.

닫기 버튼에는 포인터 핸들러를 붙이지 않는다 — 제목 버튼에만 붙으므로 닫기는 지금 그대로 동작한다.

## 10. 통과 조건

```bash
npm ci && npx prettier --check . && npm run lint && npm run typecheck && npm test
```

### 10.1 기계가 볼 것

**`hit.test.ts`** (새 파일)

- 칸 하나 — 오른쪽 25% 안이면 `1`, 경계 바로 왼쪽이면 `null`, 왼쪽 끝이면 `null`
- 칸 둘 — 가운데 왼쪽이면 `0`, 오른쪽이면 `1`, 정확히 가운데면 `1`
- `area.left` 가 0이 아닐 때도 맞다 (사이드바가 열려 있으면 본문이 오른쪽으로 밀린다)

**`panes.test.ts`** (새 파일)

- 빈 칸이 없으면 그대로 돌려준다
- 앞 칸이 비면 걷어내고 `focus` 를 한 칸 당긴다
- 뒷 칸이 비면 걷어내고 `focus` 는 그대로다
- `focus` 칸 자체가 비면 `0` 이 된다
- 전부 비면 **빈 칸 하나를 남긴다**

**`workspace.test.ts`** (개정) — 기존 탭 테스트가 `panes` 모델로 다시 쓰이고, 아래가 더해진다

- `moveTabToPane` 으로 칸이 둘이 된다
- 칸이 둘일 때 반대 칸으로 옮기면 원래 칸에서 사라진다
- 마지막 탭을 옮기면 빈 칸이 정리돼 칸이 도로 하나다
- 같은 칸으로의 드롭은 아무것도 바꾸지 않는다
- 오른쪽 칸의 마지막 탭을 닫으면 칸이 하나가 되고 `activePane` 이 0이다
- 이미 열린 노트를 사이드바에서 다시 열면 **그 탭이 있는 칸**으로 포커스가 간다
- 볼트를 바꾸면 칸이 하나로 돌아가고 탭이 비워진다

`DragLayer.tsx` · `Pane.tsx` 는 테스트하지 않는다 — `vitest.config.ts` 가 `.test.ts` 만 잡고
`environment: "node"` 다.

### 10.2 사람이 볼 것

CLAUDE.md §7 — 화면은 사람이 본다.

- 탭을 오른쪽 끝으로 끌면 **드롭 존이 강조되고**, 놓으면 칸이 갈라지나
- 칸이 둘일 때 탭을 반대 칸으로 끌어 옮길 수 있나
- 오른쪽 칸의 마지막 탭을 닫으면 칸이 도로 하나가 되나
- **3px 안 움직이고 놓으면 클릭으로 처리되나** (탭이 그냥 활성화되나)
- 드래그 중 창 밖으로 나갔다 놓으면 **아무 일도 안 일어나나**
- 탭 줄의 빈 공간을 끌면 **창이 여전히 끌리나** (§3 — 여기가 깨지기 쉽다)
- 닫기 버튼이 드래그에 먹히지 않고 그대로 닫나
- 왼쪽에 노트, 오른쪽에 쿼리 탭을 두고 둘 다 멀쩡히 보이나
- 그래프 탭을 오른쪽으로 끌면 배치가 새로 잡히나 (§7 — 의도된 동작이다)
- 오른쪽 칸을 마지막으로 만진 뒤 사이드바에서 노트를 열면 **오른쪽에** 뜨나

## 11. 이번에 하지 않는 것

- **칸 너비 조절** — `paneRatio` · 구분선 드래그 · 키보드 접근성
- **N칸 · 중첩 분할 · 세로 분할**
- **같은 칸 안 탭 재정렬**
- **같은 노트를 양쪽 칸에**
- **드래그로 칸 밖(새 창)에 떨구기**
- **키보드 단축키로 분할** (`Ctrl+\` 같은 것)
- **그래프 배치 이관** — §7
