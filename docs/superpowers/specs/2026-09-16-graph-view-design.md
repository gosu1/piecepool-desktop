# PiecePool Desktop — 그래프 뷰 — 설계

- 날짜: 2026-09-16
- 상태: 설계 승인됨 (구현 계획 대기)
- 상위 문서: `2026-09-05-electron-rebuild-design.md` — 재구축 전체 설계. 이 문서는 그 **8단계의 그래프 뷰**와, 그것이 요구하는 **2단계(`core/index`)의 최소 절단면**을 함께 다룬다
- 선행: `2026-09-15-tabs-and-wiki-read-design.md` — 탭이 열리고 원문이 보인다. 그 문서가 "그래프"를 범위 밖으로 미뤄 둔 자리다
- 나란히 가는 조각: `2026-09-16-note-rendering-design.md` — 같은 8단계의 **표시** 절반. 둘 다 `renderer/features/` 를 처음 만든다. 순서 의존은 없다
- 참고: 구 레포 `~/dev/piecepool` 의 `src/app/shell/Ribbon.tsx`(리본 버튼 패턴) · `src/ds/icons/index.tsx`(`GraphIcon`) · `src/lib/CytoscapeGraph.tsx`(d3-force 물리 · alpha 냉각)

## 1. 무엇을 만드나

**볼트 전체의 `[[링크]]` 관계를 하나의 그래프로 그린다.** 옵시디언 전역 그래프와 같다.

리본(좌측 아이콘 바)의 사이드바 토글 **아래**에 그래프 버튼을 둔다. 누르면 **그래프 탭**이
열리고 본문 영역을 차지한다. 노드를 누르면 그 노트의 탭이 열린다.

**관계에 타입을 붙이지 않는다.** 구 레포는 `RelationType` 12종에 색·선모양·계층축을 걸었다.
재구축 설계가 그 모델을 폐기했고(README 비교표 "관계 타입 12종 → 타입 없는 `[[]]` 링크"),
이 문서는 그 결정을 화면까지 관철한다. 엣지는 전부 같은 선이고 **화살표도 없다** —
방향에 의미가 없는데 화살표를 그리면 거짓 정보가 된다.

### 1.1 이것은 화면 조각이 아니라 경계 조각이다

그래프를 그리려면 링크 색인이 있어야 하는데 `src/core/index/` 는 전부 `unimplemented` 스텁이다.
그리고 `renderer/` 는 `core/` 를 import 할 수 없다(`eslint.config.js` 의 `no-restricted-paths`).
따라서 이 조각은 **2단계(`core/index`)를 부분 개봉하고 IPC 경계를 한 칸 넓히는 일**을 포함한다.
CLAUDE.md §2 의 "멈추고 물어라" 1번(FROZEN 시그니처)·3번(요청 밖 스텁)에 걸리므로
착수 전 합의를 받았다 (2026-09-16).

## 2. 결정 여섯

| 항목      | 결정                                             | 기각한 것                          | 근거                                                                         |
| --------- | ------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------------------- |
| 진입점    | 리본 사이드바 토글 **아래** 버튼 → **그래프 탭** | 본문 전체화면 모드 · 사이드바 패널 | 옵시디언 동일. 노트 탭과 나란히 오간다                                       |
| 색인 위치 | **main** — `core/index` 구현 + `graph:build` IPC | renderer 가 자기 파서로 자급       | 백링크·검색·`wiki:lint` 가 같은 색인을 재사용한다. IPC 왕복이 1회다          |
| 렌더링    | **d3-force + Canvas 2D 직접**                    | Cytoscape (legacy ADR-0006)        | ADR-0006 의 근거가 "타입 엣지·필터"였다. 타입을 버리면 근거가 사라진다       |
| 노드 범위 | 볼트의 모든 `.md`, 숨김 폴더 제외                | `wiki/` 만                         | 제품이 지키는 여섯 중 2번 — 폴더 체계를 강제하지 않는다                      |
| 갱신      | **탭을 열 때 빌드 + 새로고침 버튼**              | 볼트 열 때 선빌드 · 파일 감시      | 볼트 여는 경로를 느리게 하지 않는다. `watch.ts` 는 `OWNER: A` 라 안 건드린다 |
| 캐시      | **없다.** 매번 재빌드                            | `saveIndex` / `loadIndex`          | 실측 볼트가 15~62장이다. 캐시는 무효화 규칙을 통째로 데려온다                |

## 3. 데이터 흐름

```
리본 ◈ 클릭
 └─ store.openGraphTab()
     └─ window.piecepool.buildGraph()          preload 화이트리스트 (인자 없음)
         └─ ipcMain.handle("graph:build")      main/ipc.ts — 모듈 변수 opened 를 쓴다
             ├─ scanVault(v)   → VaultIndex    core/index/scan.ts
             └─ toGraph(ix)    → GraphData     { nodes: [{id,title}], edges: [{source,target}] }
                 └─ renderer: d3-force 가 좌표를, <canvas> 가 픽셀을 만든다
```

**`readRaw` 와 달리 renderer 가 경로를 보내지 않는다.** 인자가 없으므로 경로 검증 표면이
늘지 않는다 — `preload/index.ts` 주석이 _"여기에 경로를 받는 함수를 더할 때마다 그 검증을
통과하는지 확인해야 한다"_ 고 못 박은 그 자리를 건드리지 않는다.

`opened` 가 `null`(볼트를 아직 안 열었다)이면 `note:read` 와 똑같이
`PiecePoolError("vault_not_found")` 를 던지고 `wrap()` 이 `Result` 실패로 만든다.

## 4. `core/index` 에서 채우는 것 / 남기는 것

**채운다 (5개)**

| 함수             | 파일       | 마커                                             |
| ---------------- | ---------- | ------------------------------------------------ |
| `normalizeTitle` | `links.ts` | 가배치 2단계                                     |
| `parseLinks`     | `links.ts` | **`// FROZEN`** — 시그니처 그대로, 구현만 채운다 |
| `resolveLink`    | `links.ts` | 가배치 2단계                                     |
| `scanVault`      | `scan.ts`  | 없음 (내부 구현)                                 |
| `toGraph`        | `scan.ts`  | 없음 (내부 구현)                                 |

**스텁으로 남긴다** — `saveIndex` · `loadIndex` · `backlinksOf`(`links.ts`) · `watchVault`(`watch.ts`).
CLAUDE.md §5 대로 지나가다 구현하지 않는다. `watch.ts` 는 `OWNER: A` 이고 마커가
_"억제 등록/해제 API 미확정, 2단계에서 확정"_ 이라 남의 구간을 먼저 정해 버리게 된다.

### 4.1 `normalizeTitle` — 공백을 제거한다

```
t.normalize("NFC").trim().toLowerCase() 뒤 모든 공백류 제거
```

- **NFC 정규화** — macOS 는 파일명을 NFD 로 저장한다. 안 하면 같은 한글 제목이 플랫폼마다 다른 키가 된다
- **공백 제거** — CLAUDE.md 가 든 구 레포 PIE-64("교착상태" 와 "교착 상태" 로 위키가 두 장 생겼다)가
  이것으로만 막힌다

영어에서는 `machine learning` 과 `machinelearning` 이 같은 키가 된다. 한글 위키가 주 용도이고
PIE-64 가 실제로 지불한 비용이므로 그쪽을 택한다. 바꿔야 할 근거가 생기면 이 절을 고친다.

**맵을 만드는 쪽(`scanVault`)과 조회하는 쪽(`resolveLink`)이 반드시 이 함수 하나만 쓴다.**
다르면 볼트 전체가 깨진 링크가 되는데 타입은 아무것도 잡아 주지 않는다.

### 4.2 `parseLinks` — 시그니처는 동결, 구현만 채운다

첫 줄이 `// FROZEN: parseLinks 만 동결` 이다. **시그니처를 바꾸지 않으므로 합의 대상이 아니다.**

받아들이는 것:

| 입력                              | `to`                  | `alias` | `page` |
| --------------------------------- | --------------------- | ------- | ------ |
| `[[대상]]`                        | `대상`                | 없음    | 없음   |
| `[[대상\|표시]]`                  | `대상`                | `표시`  | 없음   |
| `[[대상#소제목]]`                 | `대상`                | 없음    | 없음   |
| `[[대상#^blockid]]`               | `대상`                | 없음    | 없음   |
| `![[sources/files/x.pdf]]`        | `sources/files/x.pdf` | 없음    | 없음   |
| `![[sources/files/x.pdf#page=7]]` | `sources/files/x.pdf` | 없음    | `7`    |

fragment 는 `#page=N` 을 빼면 버린다 — 재구축 설계 §6.1 의 범위 밖이다.

**코드 펜스와 인라인 코드 안의 `[[예시]]` 는 링크가 아니다.** 구 레포는 remark mdast 의
text 노드 위에서만 돌아 이것이 공짜였는데, 여기는 raw 문자열을 받으므로 직접 걸러야 한다.
놓치면 마크다운 문법을 설명하는 위키 페이지마다 유령 깨진 링크가 `wiki:lint` 에 영구히 남는다.

거르는 순서: ① 펜스로 둘러싸인 줄 범위를 먼저 지운다 ② 남은 줄에서 인라인 코드(백틱 쌍)를
지운다 ③ 그 뒤에 `[[…]]` 를 찾는다. 지울 때는 **같은 길이의 공백으로 치환한다** —
오프셋이 밀리면 나중에 위치가 필요해질 때 통째로 틀린다.

### 4.3 `resolveLink` — 제목 먼저, 경로 다음

```
normalizeTitle(to) 로 targets.titles 조회  →  맞으면 그 NotePath
to 를 경로로 보고 targets.files 조회       →  맞으면 그 NotePath
둘 다 실패                                 →  null (깨진 링크)
```

**동명 노트 처리는 이번 조각에 없다.** 시그니처가 `from` 을 받고 주석이 _"링크가 놓인 노트에
가까운 후보를 우선한다"_ 고 요구하지만, 같은 주석이 _"모호성 자체를 사용자에게 보고하는 것은
lint 규칙의 몫"_ 이라고 정해 뒀다. 지금은 맵에 먼저 들어온 것이 이긴다. `from` 은 인자로
남아 있고 쓰이지 않는다 — 시그니처가 동결이 아니므로 나중에 채울 수 있다.

### 4.4 `scanVault` — `readTree` 를 재사용한다

`core/vault/tree.ts` 의 `readTree` 가 이미 정확히 필요한 순회를 한다 — `.md` 만, 숨김 폴더
(`.git`·`.obsidian`·`.piecepool`) 제외, 심볼릭 링크 제외, POSIX 구분자 경로. 트리를 평탄화해
경로 목록을 얻는다. 같은 순회를 다시 짜면 두 규칙이 조용히 갈라진다.

```
readTree(v) → 평탄화 → NotePath[]
  ├─ targets.titles: normalizeTitle(basename - ".md") → NotePath
  ├─ targets.files:  Set<NotePath>
  └─ 각 파일: readRaw(v, p) → parseLinks(p, body) → resolveLink 로 resolved 채움
```

`sources/files/` 의 PDF 는 `.md` 가 아니라 `readTree` 에 안 들어온다. 따라서 `targets.files`
에도 없고 `![[…pdf]]` 는 깨진 링크로 남는다. 그래프에는 영향이 없다(§4.5) — 첨부파일 노드는
범위 밖이다(§11).

읽기 실패는 **그 파일만 건너뛴다.** 볼트 하나에 권한 없는 파일이 한 장 있다고 그래프 전체가
안 뜨는 쪽이 더 나쁘다.

### 4.5 `toGraph` — 제목 원문이 없다

`GraphData.nodes` 는 `{ id: NotePath; title: string }` 을 요구하는데 `VaultIndex` 에는
**제목 원문이 없다** — `targets.titles` 는 `Map<정규화된제목, NotePath>` 라 키에서 원문을
복구할 수 없다.

**`VaultIndex` 에 필드를 더하지 않는다. `title` 은 경로의 basename 에서 `.md` 를 뗀 것으로 정한다.**
옵시디언 규칙 그대로고, 공유 타입을 늘리지 않는다. 프론트매터의 `aliases` 는 그래프에 쓰지 않는다.

엣지 규칙:

- `resolved === null` 인 링크는 **엣지가 아니다.** 깨진 링크 보고는 `wiki:lint` 의 몫이다
- **자기 자신 링크는 버린다** — 화면에 점 위의 고리로만 남고 뜻이 없다
- **A→B 와 B→A 는 엣지 하나로 접는다.** 방향이 없으므로 두 선이 겹쳐 굵어 보이는 것은 거짓 신호다
- 같은 노트가 같은 대상을 여러 번 링크해도 엣지 하나다

## 5. FROZEN 변경 — 합의가 필요한 1건

`src/shared/ipc.ts` (첫 줄 `// FROZEN: 파일 전체`). **더하기만 한다 — 기존 시그니처는 하나도 바뀌지 않는다.**

```ts
export const CHANNEL = {
  …,
  graphBuild: "graph:build",
} as const;

export interface PiecePoolApi {
  …
  /** 링크 색인에서 파생한 그래프. 인자가 없다 — 열린 볼트 전체가 대상이다. */
  buildGraph: () => Promise<Result<GraphData>>;
}
```

`GraphData` 는 `shared/types.ts` 에 이미 있다. `import type` 한 줄만 는다.

`shared/types.ts` 는 **안 건드린다.** `Fm` 도 `GraphData` 도 그대로다.

## 6. `Tab` 을 판별 유니온으로 바꾼다

지금 탭은 `path: NotePath` 가 곧 신원이다(`workspace.ts` 의 `tabs.some(t => t.path === path)` ·
`closeTab` · `activeTab` 이 모두 `NotePath` 를 키로 쓴다). 그래프 탭은 파일이 아니라서
이 키 공간에 들어갈 수 없다. 가짜 경로를 밀어넣는 대신 유니온으로 간다.

```ts
export type Tab =
  | {
      kind: "note";
      id: string;
      path: NotePath;
      title: string;
      body: string | null;
      error: string | null;
      seq: number;
    }
  | { kind: "graph"; id: "graph"; title: "그래프" };

// id = `note:${path}` 또는 "graph"
// activeTab: string | null
```

**`id` 를 따로 두는 이유:** `activeTab: NotePath | "graph"` 로 하면 `NotePath` 가 `string`
별칭이라 타입이 충돌을 못 잡는다. 접두사를 붙여 두 키 공간을 물리적으로 분리한다.

파급은 세 파일이다.

| 파일           | 바뀌는 것                                                                           |
| -------------- | ----------------------------------------------------------------------------------- |
| `TabStrip.tsx` | `t.path` → `t.id`. 다시 누르는 동작이 `openTab(path)` 에서 `focusTab(id)` 로 갈린다 |
| `NoteView.tsx` | 활성 탭의 `kind` 로 분기 — `"note"` 면 지금 그대로, `"graph"` 면 `<GraphView/>`     |
| `workspace.ts` | `openTab` · `closeTab` · `applied` · 새 `openGraphTab` · `focusTab`                 |

`FileTree.tsx` 는 안 바뀐다 — `openTab(path, label)` 시그니처를 유지한다.

**볼트를 바꾸면 그래프 탭도 함께 닫는다.** `applied()` 가 탭을 비우는 것과 같은 이유다 —
이전 볼트의 그래프가 새 볼트의 탭에 남아 있는 쪽이 더 나쁘다.

**그래프 탭은 하나만 열린다.** 이미 열려 있으면 활성화만 한다(`id` 가 `"graph"` 하나뿐이라 공짜다).

## 7. 파일 배치

```
src/renderer/features/graph/
  GraphView.tsx    캔버스 마운트 · 시뮬 수명주기 · 포인터 이벤트 · 새로고침 버튼
  layout.ts        d3-force 시뮬 구성              (순수 — 테스트 가능)
  draw.ts          ctx 에 노드·엣지·라벨을 그린다   (순수)
  hit.ts           화면 좌표 → 노드 찾기            (순수 — 테스트 가능)
```

`features/` 폴더가 여기서 처음 생긴다. 재구축 설계 §4.1 이 `renderer/` 를 `app/`·`features/`·
`ds/`·`store/` 로 규정했고 크롬 설계가 _"담을 것이 없다"_ 며 미뤄 뒀던 자리다.
`ds/` 는 이번에도 만들지 않는다 — 그래프는 재사용할 프리미티브를 만들지 않는다.

**DOM 을 만지는 것은 `GraphView.tsx` 하나다.** 나머지 셋은 순수 함수라 jsdom 없이 테스트한다.

## 8. 그리기 규칙

- **노드** 반지름 `4 + √(연결수)`. 평소 `--ds-ink-2`, 활성 노트 `--ds-primary`
- **엣지** `--ds-hairline` 실선. **화살표 없음** (§1)
- **라벨** 줌 ≥ 1.1 이거나 hover 이웃일 때만. 평소엔 구조만 보인다
- **hover** 이웃 아닌 노드·엣지는 알파를 떨군다
- **색은 하드코딩하지 않는다.** `getComputedStyle` 로 `--ds-*` 토큰을 읽는다
  (구 레포 `graphStyle.ts` 의 `readTokens` 패턴). 테마가 바뀌면 따라온다
- `devicePixelRatio` 로 캔버스 백버퍼를 스케일한다. 안 하면 고DPI 에서 흐려진다

**시뮬레이션은 alpha 로 스스로 식어 멈춘다 → 정지 상태 CPU 0.**
노드를 잡으면 `alphaTarget` 으로 재가열되어 이웃이 스프링처럼 재배치되고, 놓으면 다시 식는다.
구 레포가 검증한 수명주기 그대로다.

**탭이 바뀌면 `requestAnimationFrame` 루프를 멈춘다.** 안 멈추면 안 보이는 캔버스에 계속 그린다.

## 9. 리본 버튼

```
┌──────┐
│ ▣    │  사이드바 토글 (지금 있는 것)
│ ◈    │  그래프        ← 새로 다는 것
└──────┘
```

지금 `Ribbon.tsx` 는 버튼 하나를 인라인으로 갖고 있다. 둘이 되므로 구 레포 패턴대로
`RibbonButton` 을 파일 안에 뽑는다 — `active` 상태(그래프 탭이 활성일 때 `bg-fill-subtle`)가
두 버튼에 같은 모양으로 필요하다.

아이콘은 구 레포 `GraphIcon`(원 셋 + 연결선)을 16px 뷰박스로 옮겨 그린다. `ds/icons` 를
만들지 않으므로 지금 사이드바 아이콘과 같이 인라인 `<svg>` 로 둔다.

**`app-no-drag` 와 `relative z-10` 을 둘 다 받아야 한다** — 상단 32px 드래그 띠와 겹치는 자리다.
리본은 이미 `relative z-10` 이라 버튼에는 `app-no-drag` 만 붙이면 된다(지금 버튼과 동일).

## 10. 의존성

CLAUDE.md §2-2 에 따라 목록을 먼저 확정한다.

| 더한다                         | 안 더한다                        |
| ------------------------------ | -------------------------------- |
| `d3-force` · `@types/d3-force` | `cytoscape` · `@types/cytoscape` |

`d3-force` 를 쓰는 이유는 **Barnes-Hut quadtree** 하나다. 반발력을 직접 짜면 O(n²) 이라
수백 노드에서 버벅이고, quadtree 를 직접 지으면 `d3-force` 를 다시 쓰는 것만 못하다.
배치만 쓰고 그리기는 안 쓴다.

`cytoscape` 를 빼는 이유는 legacy ADR-0006 의 근거가 _"타입 엣지·필터·타입별 색상·strength 두께"_
였기 때문이다. 관계 타입이 사라지면서 그 요구가 통째로 없어졌고, 남는 것은 "원과 선을 그리고
줌·팬·드래그" 뿐이다. 셀렉터·스타일시트 엔진을 그 일에 지고 가지 않는다.

**새 ADR 한 장(`docs/adr/0004-graph-canvas-d3force.md`)을 써서 legacy ADR-0006 을 대체한다.**
CLAUDE.md §9 표의 "그래프 렌더링" 줄도 그 PR 에서 함께 고친다.

## 11. 범위 밖

로컬 그래프(노트별 미니 그래프) · 백링크 패널 · 검색 필터 · force 파라미터 설정 패널 ·
깊이 슬라이더 · 고아 노드 토글 · 파일 감시 자동 갱신 · 색인 디스크 캐시 ·
태그 노드 · 첨부파일(PDF) 노드 · 깨진 링크 노드 · 동명 노트 해석 ·
`[[링크]]` 클릭 이동(노트 렌더링 조각의 몫) · 그래프 탭 재시작 복원 · 노드 위치 저장

## 12. 통과 조건

### 12.1 기계가 잡는 것

`environment: "node"` 에서 도는 순수 함수 테스트다. DOM 도 jsdom 도 필요 없다.

- **`parseLinks`** — 이 조각에서 가장 조용히 틀린다
  - `[[대상]]` · `[[대상|별칭]]` · `[[대상#앵커]]` · `![[파일#page=N]]`
  - 괄호가 든 제목 `[[@DETR (2020)]]`
  - 한 줄에 여러 개 · 닫히지 않은 `[[` · 빈 `[[]]`
  - **코드 펜스 안의 `[[예시]]` 는 링크가 아니다**
  - **인라인 코드 안의 `[[예시]]` 는 링크가 아니다**
- **`normalizeTitle`**
  - "교착상태" 와 "교착 상태" 가 같은 키가 된다
  - NFD 로 쓴 한글과 NFC 로 쓴 한글이 같은 키가 된다
  - 대소문자가 다른 영어 제목이 같은 키가 된다
- **`resolveLink` · `scanVault`** — 임시 폴더에 볼트 픽스처를 만든다 (CLAUDE.md §3 — 이 레포에 커밋해서 검증하지 않는다)
  - 제목으로 해석된다 · 경로로 해석된다 · 없는 대상은 `null`
  - 숨김 폴더의 `.md` 는 노드가 안 된다
- **`toGraph`**
  - 깨진 링크는 엣지가 안 된다
  - 자기 자신 링크는 엣지가 안 된다
  - A→B 와 B→A 가 엣지 하나가 된다
  - 노드 수가 볼트의 `.md` 수와 같다 (링크가 0개여도 고아 노드로 남는다)
- **`hit.ts`** — 줌·팬이 걸린 상태에서 화면 좌표가 맞는 노드를 짚는다

### 12.2 사람이 봐야 하는 것

CLAUDE.md §7 — 에이전트가 대신할 수 없다.

- **실제 볼트를 열어 그래프를 눈으로 본다** — 노드 수가 `.md` 수와 맞는지, 뭉치는 모양이
  옵시디언 그래프와 비슷한지, 노드를 눌렀을 때 맞는 노트가 열리는지
- **비포·애프터 스크린샷** — 리본 버튼과 그래프 탭. 리뷰 요청 전에 첨부한다

### 12.3 CI

```bash
npm ci && npx prettier --check . && npm run lint && npm run typecheck && npm test
```

## 13. 이 설계가 임의로 정한 것 둘

나중에 이 문서를 읽는 사람이 "왜 이렇게 했지" 하고 멈추지 않도록 적어 둔다.
설계문서에 근거가 없어 **판단으로 메운 자리**다.

1. **`normalizeTitle` 이 공백을 전부 제거한다** (§4.1) — 영어 제목에서 `machine learning` 과
   `machinelearning` 이 같아진다. PIE-64 가 실제로 지불한 비용을 근거로 택했다
2. **`resolveLink` 가 `from` 을 쓰지 않는다** (§4.3) — 동명 노트는 맵에 먼저 들어온 것이 이긴다.
   모호성 보고는 `wiki:lint` 의 몫이라고 같은 주석이 정해 뒀다
