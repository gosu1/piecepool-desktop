import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { GraphData, NotePath } from "../../../shared/types.ts";

/**
 * 시뮬이 좌표를 실어 주는 노드. x·y 는 forceSimulation() 호출 시점에
 * 동기로 채워지므로 buildLayout 이 반환한 노드엔 이미 있다.
 * optional 인 이유는 buildLayout 을 거치지 않고 손으로 만든 SimNode 도
 * 이 타입을 쓰기 때문이다.
 */
export interface SimNode extends SimulationNodeDatum {
  id: NotePath;
  title: string;
  /** 연결 수. 반지름을 정한다. */
  degree: number;
}

/**
 * forceLink 가 문자열을 노드 객체로 **제자리에서 바꿔 넣는다** — 둘 다 받는 타입이어야 한다.
 * d3 의 SimulationLinkDatum 을 명시적으로 확장한다. 모양만 맞춰 두면
 * forceSimulation<SimNode, SimEdge> 의 제약에서 걸린다.
 */
export interface SimEdge extends SimulationLinkDatum<SimNode> {
  source: NotePath | SimNode;
  target: NotePath | SimNode;
}

export interface Layout {
  sim: Simulation<SimNode, SimEdge>;
  nodes: SimNode[];
  edges: SimEdge[];
  /**
   * hover 이웃 조회용. forceLink 가 돌고 나면 edges 의 source/target 은
   * 노드 객체로 바뀌어 문자열 형태를 못 구한다 — 아직 문자열인 g 에서 미리 구해 둔다.
   */
  adj: Map<NotePath, Set<NotePath>>;
}

/** 연결 수. 반지름이 이것을 쓴다. 고아 노드도 0 으로 들어 있다. */
export function degrees(g: GraphData): Map<NotePath, number> {
  const d = new Map<NotePath, number>();
  for (const n of g.nodes) d.set(n.id, 0);
  for (const e of g.edges) {
    d.set(e.source, (d.get(e.source) ?? 0) + 1);
    d.set(e.target, (d.get(e.target) ?? 0) + 1);
  }
  return d;
}

/** 고아도 보여야 하므로 바닥이 4 다. */
export function radiusOf(degree: number): number {
  return 4 + Math.sqrt(degree);
}

/** hover 강조가 쓰는 이웃 목록. 방향이 없으므로 양쪽에 담는다. */
export function adjacency(g: GraphData): Map<NotePath, Set<NotePath>> {
  const a = new Map<NotePath, Set<NotePath>>();
  for (const n of g.nodes) a.set(n.id, new Set<NotePath>());
  for (const e of g.edges) {
    a.get(e.source)?.add(e.target);
    a.get(e.target)?.add(e.source);
  }
  return a;
}

/**
 * 힘 넷으로 배치한다. alpha 로 스스로 식어 멈추므로 정지 상태 CPU 는 0 이다.
 * 호출한 쪽이 반드시 sim.stop() 으로 끝낸다 — 안 세우면 타이머가 남는다.
 */
export function buildLayout(g: GraphData, w: number, h: number): Layout {
  const deg = degrees(g);
  const nodes: SimNode[] = g.nodes.map((n) => ({
    id: n.id,
    title: n.title,
    degree: deg.get(n.id) ?? 0,
  }));
  const edges: SimEdge[] = g.edges.map((e) => ({ source: e.source, target: e.target }));

  const sim = forceSimulation<SimNode, SimEdge>(nodes)
    .force(
      "link",
      forceLink<SimNode, SimEdge>(edges)
        .id((n) => n.id)
        .distance(60),
    )
    .force("charge", forceManyBody<SimNode>().strength(-120))
    .force("center", forceCenter(w / 2, h / 2))
    // 반지름 + 여백만큼 떨어뜨린다. 허브가 이웃을 덮지 않는다.
    .force(
      "collide",
      forceCollide<SimNode>((n) => radiusOf(n.degree) + 4),
    );

  return { sim, nodes, edges, adj: adjacency(g) };
}
