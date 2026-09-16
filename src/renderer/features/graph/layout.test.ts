import { describe, expect, it } from "vitest";
import { adjacency, buildLayout, degrees, radiusOf } from "./layout.ts";
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

  it("엣지 수를 그대로 옮긴다", () => {
    const { sim, edges } = buildLayout(g, 800, 600);
    sim.stop();
    expect(edges).toHaveLength(2);
  });
});
