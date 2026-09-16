import { describe, expect, it } from "vitest";
import { hitNode, toWorld } from "./hit.ts";
import type { View } from "./hit.ts";
import type { SimNode } from "./layout.ts";

const nodes: SimNode[] = [
  { id: "A.md", title: "A", degree: 0, x: 100, y: 100 },
  { id: "B.md", title: "B", degree: 0, x: 300, y: 100 },
];

const IDENTITY: View = { zoom: 1, panX: 0, panY: 0 };

describe("toWorld", () => {
  it("변환이 없으면 화면 좌표가 곧 시뮬 좌표다", () => {
    expect(toWorld(IDENTITY, 50, 70)).toEqual({ x: 50, y: 70 });
  });

  it("팬을 되돌린다", () => {
    expect(toWorld({ zoom: 1, panX: 20, panY: 10 }, 50, 70)).toEqual({ x: 30, y: 60 });
  });

  it("줌을 되돌린다", () => {
    expect(toWorld({ zoom: 2, panX: 0, panY: 0 }, 50, 70)).toEqual({ x: 25, y: 35 });
  });
});

describe("hitNode", () => {
  it("노드 위를 짚는다", () => {
    expect(hitNode(nodes, IDENTITY, 100, 100)?.id).toBe("A.md");
  });

  it("빈 곳은 null 이다", () => {
    expect(hitNode(nodes, IDENTITY, 200, 300)).toBeNull();
  });

  it("줌과 팬이 걸린 상태에서도 맞는 노드를 짚는다", () => {
    // 시뮬 (300,100) 은 zoom 2 · pan(50,20) 에서 화면 (650,220) 이다.
    const v: View = { zoom: 2, panX: 50, panY: 20 };
    expect(hitNode(nodes, v, 650, 220)?.id).toBe("B.md");
  });

  it("좌표가 아직 없는 노드는 건너뛴다", () => {
    const pending: SimNode[] = [{ id: "X.md", title: "X", degree: 0 }];
    expect(hitNode(pending, IDENTITY, 0, 0)).toBeNull();
  });
});
