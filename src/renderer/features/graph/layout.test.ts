import { describe, expect, it } from "vitest";
import { adjacency, buildLayout, degrees, radiusOf, recenter } from "./layout.ts";
import type { SimNode } from "./layout.ts";
import type { ForceCenter } from "d3-force";
import type { GraphData } from "../../../shared/types.ts";

/** A—B, A—C. A 가 허브다. D 는 고아다. */
const g: GraphData = {
  nodes: [
    { id: "A.md", title: "A" },
    { id: "B.md", title: "B" },
    { id: "C.md", title: "C" },
    { id: "D.md", title: "D" },
  ],
  edges: [
    { source: "A.md", target: "B.md" },
    { source: "A.md", target: "C.md" },
  ],
};

describe("degrees", () => {
  it("양쪽 끝을 모두 센다", () => {
    const d = degrees(g);
    expect(d.get("A.md")).toBe(2);
    expect(d.get("B.md")).toBe(1);
  });

  it("고아 노드는 0 이다 — 빠지지 않는다", () => {
    expect(degrees(g).get("D.md")).toBe(0);
  });
});

describe("radiusOf", () => {
  it("고아도 보이는 크기를 갖는다", () => {
    expect(radiusOf(0)).toBe(4);
  });

  it("연결이 많을수록 커진다", () => {
    expect(radiusOf(4)).toBeGreaterThan(radiusOf(1));
  });
});

describe("adjacency", () => {
  it("양방향으로 담는다 — 방향이 없다", () => {
    const a = adjacency(g);
    expect([...(a.get("A.md") ?? [])].sort()).toEqual(["B.md", "C.md"]);
    expect([...(a.get("B.md") ?? [])]).toEqual(["A.md"]);
  });

  it("고아 노드도 빈 집합으로 들어 있다", () => {
    expect(adjacency(g).get("D.md")).toEqual(new Set());
  });
});

describe("buildLayout", () => {
  it("노드마다 degree 를 실어 준다", () => {
    const { sim, nodes } = buildLayout(g, 800, 600);
    // 시뮬은 만들자마자 타이머를 돌린다. 테스트 프로세스를 붙잡지 않도록 곧바로 세운다.
    sim.stop();
    expect(nodes.map((n) => [n.id, n.degree])).toEqual([
      ["A.md", 2],
      ["B.md", 1],
      ["C.md", 1],
      ["D.md", 0],
    ]);
  });

  it("엣지의 source/target 을 노드 객체로 그대로 옮긴다", () => {
    const { sim, edges } = buildLayout(g, 800, 600);
    sim.stop();
    // forceLink 가 문자열이던 source/target 을 노드 객체로 제자리에서 바꿔 넣는다 —
    // 개수만 세면 하나를 빼고 다른 하나를 중복해도 통과한다.
    expect(edges.map((e) => [(e.source as SimNode).id, (e.target as SimNode).id])).toEqual([
      ["A.md", "B.md"],
      ["A.md", "C.md"],
    ]);
  });

  it("adj 는 forceLink 가 edges 를 바꿔 넣은 뒤에도 이웃을 담고 있다", () => {
    const { sim, adj } = buildLayout(g, 800, 600);
    sim.stop();
    expect([...(adj.get("A.md") ?? [])].sort()).toEqual(["B.md", "C.md"]);
    expect(adj.get("D.md")).toEqual(new Set());
  });
});

describe("recenter", () => {
  it("중심 힘을 새 크기의 한가운데로 옮긴다", () => {
    const lay = buildLayout(g, 800, 600);
    recenter(lay, 400, 600);
    // 칸이 반으로 갈리면 중심도 절반으로 온다. 안 옮기면 그래프가 화면 밖으로 밀린다.
    const c = lay.sim.force("center") as ForceCenter<SimNode>;
    expect(c.x()).toBe(200);
    expect(c.y()).toBe(300);
    lay.sim.stop();
  });

  it("식은 시뮬을 다시 덥힌다", () => {
    const lay = buildLayout(g, 800, 600);
    lay.sim.alpha(0);
    recenter(lay, 400, 600);
    // 중심만 옮기고 alpha 를 안 올리면 노드가 그 자리에 굳어 있어 아무것도 안 바뀐다.
    expect(lay.sim.alpha()).toBeGreaterThan(0);
    lay.sim.stop();
  });

  it("노드를 새로 만들지 않는다", () => {
    const lay = buildLayout(g, 800, 600);
    const before = lay.nodes;
    recenter(lay, 400, 600);
    expect(lay.nodes).toBe(before);
    lay.sim.stop();
  });
});
