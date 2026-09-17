# ADR-0004: 그래프 렌더링 — Canvas 2D + d3-force

- 상태: 채택 (Accepted)
- 일자: 2026-09-16
- 대체: `docs/adr/legacy/0006-graph-rendering-cytoscape.md` (상태: 대체됨)
- 관련: `docs/superpowers/specs/2026-09-16-graph-view-design.md`

## 배경

legacy ADR-0006 은 Cytoscape.js 를 채택했다. 그 근거는 원문 그대로 **"타입 있는 지식 그래프
(12 RelationType, strength/confidence)"** 와 **"노드 클릭·타입별 색상·strength 두께·
Subject/RelationType 필터"** 였다. D3 를 기각한 이유도 _"저수준이라 직접 구현 부담"_ 이었다.

재구축에서 지식 모델이 **타입 없는 `[[]]` 링크**로 바뀌었다(README 비교표 · ADR-0001).
`RelationType` 도 `strength` 도 `confidence` 도 없다. 그 근거가 통째로 사라졌다.

## 결정

**노드 배치는 `d3-force`, 그리기는 Canvas 2D 직접.** `cytoscape` 는 넣지 않는다.

## 근거

- 남은 요구는 "원과 선을 그리고 줌·팬·드래그" 뿐이다. Cytoscape 의 셀렉터·스타일시트 엔진이
  값을 하는 자리가 없다
- 구 레포도 실제로는 **좌표를 d3-force 가 만들고 Cytoscape 는 그리기만** 했다
  (`src/lib/CytoscapeGraph.tsx`). 절반은 이미 d3 였다
- `d3-force` 를 남기는 이유는 **Barnes-Hut quadtree** 하나다. 반발력을 직접 짜면 O(n²) 이고,
  quadtree 를 직접 지으면 `d3-force` 를 다시 쓰는 것만 못하다
- 색을 `--ds-*` 토큰에서 읽으므로 Cytoscape 스타일시트와 Tailwind 토큰을 잇는 층이 사라진다

## 결과

- (+) 의존성이 넷에서 둘로 준다 (`cytoscape`·`@types/cytoscape` 제거)
- (+) 두 모델(cy 요소 ↔ 시뮬 노드) 사이 좌표 동기화가 사라진다
- (+) 그리기 규칙이 `draw.ts` 순수 함수 하나에 모인다
- (−) 노드 라벨 충돌 회피·엣지 라우팅 같은 것을 나중에 원하면 직접 짜야 한다
- (−) 수천 노드에서의 렌더 성능은 실측하지 않았다. 실측 볼트는 15~62장이다

## 대안

- **Cytoscape 유지**: 근거가 사라진 결정을 관성으로 지고 간다. 400KB 와 두 모델 동기화가 값이다
- **라이브러리 0개**: 반발력이 O(n²) 이라 수백 노드부터 버벅인다
