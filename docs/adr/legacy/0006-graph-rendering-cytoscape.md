> **상태: 대체됨.** 구 레포(Tauri+Rust)의 ADR 원문이다. 근거 보존용이며
> 새 번호 체계(`docs/adr/`) 밖에 있다. 재구축 결정은 `docs/adr/0001-*.md` 참조.

# ADR-0006: Graph 렌더링 — Cytoscape.js

- 상태: 채택 (Accepted)
- 일자: 2026-07-01
- 관련: [open-questions](../00-overview/open-questions.md) · [relation-types](../10-contracts/relation-types.md) · [40-frontend](../40-frontend/README.md)

## 배경

타입 있는 지식 그래프(12 RelationType, strength/confidence)를 인터랙티브로 렌더링해야 한다. 노드 클릭·타입별 색상·strength 두께·Subject/RelationType 필터·검색·교차 과목 허브가 요구된다. 후보: D3, Cytoscape.js, Sigma.js, React Flow, vis.js.

## 결정

**Cytoscape.js**를 채택한다. 그래프 전용 자료구조·레이아웃·이벤트 모델을 내장해 타입 엣지/필터/대규모 노드에 적합하다. Graph 파트 구현 소유 = @gosu1.

## 결과

- (+) 그래프 특화 API(레이아웃·스타일·이벤트)로 요구 기능 직접 지원.
- (+) 대규모(수백~수천 노드) 확장 여지.
- (−) React 통합은 래퍼 필요.

## 대안

- React Flow: 다이어그램/플로우 중심이라 대규모 지식그래프엔 부적합.
- D3: 저수준이라 직접 구현 부담. Sigma/vis: 생태계·요구 정합성에서 후순위.
