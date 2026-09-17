import { describe, expect, it } from "vitest";
import { draw, LABEL_ZOOM } from "./draw.ts";
import type { Palette, Scene } from "./draw.ts";
import type { SimEdge, SimNode } from "./layout.ts";
import type { View } from "./hit.ts";

/** 순서대로 쌓이는 호출 기록 한 건. 메서드 호출과 속성 대입을 같은 줄로 섞어 담는다. */
interface Call {
  op: string;
  args: unknown[];
}

const METHODS = [
  "clearRect",
  "save",
  "restore",
  "translate",
  "scale",
  "beginPath",
  "moveTo",
  "lineTo",
  "stroke",
  "arc",
  "fill",
  "fillText",
] as const;

const PROPS = ["fillStyle", "strokeStyle", "globalAlpha", "font", "lineWidth"] as const;

/**
 * ctx 를 흉내내는 기록용 스텁. 호출 순서와 인자, 속성 대입을 모두 `calls` 배열
 * 하나에 시간순으로 담는다 — "translate 가 scale 보다 먼저" 같은 순서 단언이
 * 메서드와 속성을 오가며 성립해야 하기 때문이다.
 */
function createStubCtx(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const stub: Record<string, unknown> = {};

  for (const m of METHODS) {
    stub[m] = (...args: unknown[]) => {
      calls.push({ op: m, args });
    };
  }

  for (const p of PROPS) {
    let value: unknown;
    Object.defineProperty(stub, p, {
      get: () => value,
      set: (v: unknown) => {
        value = v;
        calls.push({ op: `set:${p}`, args: [v] });
      },
    });
  }

  // draw 가 읽기만 하고 기록이 필요 없는 나머지 속성. 없으면 대입에서 그대로 던진다.
  stub.textAlign = "";
  stub.textBaseline = "";

  return { ctx: stub as unknown as CanvasRenderingContext2D, calls };
}

const palette: Palette = { node: "#111", active: "#f00", edge: "#ccc", label: "#888" };

function node(id: string, x?: number, y?: number, degree = 0): SimNode {
  return { id, title: id, degree, x, y };
}

function scene(overrides: Partial<Scene>): Scene {
  return {
    nodes: [],
    edges: [],
    view: { zoom: 1, panX: 0, panY: 0 },
    palette,
    active: null,
    lit: new Set(),
    ...overrides,
  };
}

describe("draw", () => {
  it("translate 를 scale 보다 먼저 건다 — hit.toWorld 가 이 순서의 역을 가정한다", () => {
    const { ctx, calls } = createStubCtx();
    const view: View = { zoom: 2, panX: 10, panY: 20 };
    draw(ctx, 100, 100, scene({ view }));

    const t = calls.findIndex((c) => c.op === "translate");
    const s = calls.findIndex((c) => c.op === "scale");
    expect(t).toBeGreaterThanOrEqual(0);
    expect(s).toBeGreaterThan(t);
    expect(calls[t].args).toEqual([10, 20]);
    expect(calls[s].args).toEqual([2, 2]);
  });

  it("줌이 문턱 아래고 강조가 없으면 라벨을 안 그린다", () => {
    const { ctx, calls } = createStubCtx();
    const n = node("A.md", 10, 10);
    draw(ctx, 100, 100, scene({ nodes: [n], view: { zoom: LABEL_ZOOM - 0.1, panX: 0, panY: 0 } }));
    expect(calls.some((c) => c.op === "fillText")).toBe(false);
  });

  it("줌이 문턱 이상이면 노드 제목을 그린다", () => {
    const { ctx, calls } = createStubCtx();
    const n = node("A.md", 10, 10);
    draw(ctx, 100, 100, scene({ nodes: [n], view: { zoom: LABEL_ZOOM, panX: 0, panY: 0 } }));
    const labels = calls.filter((c) => c.op === "fillText");
    expect(labels).toHaveLength(1);
    expect(labels[0].args[0]).toBe("A.md");
  });

  it("강조 밖의 노드는 옅게, 강조 안의 노드는 온전하게 그린다", () => {
    const { ctx, calls } = createStubCtx();
    const lit = node("lit.md", 0, 0);
    const dim = node("dim.md", 50, 50);
    draw(ctx, 100, 100, scene({ nodes: [lit, dim], lit: new Set(["lit.md"]) }));

    // globalAlpha 대입과 arc 호출이 노드마다 짝을 이뤄 순서대로 나온다 —
    // 대입 직후의 arc 를 그 노드의 알파로 읽는다.
    let current: unknown;
    const alphaAt: Record<string, unknown> = {};
    for (const c of calls) {
      if (c.op === "set:globalAlpha") current = c.args[0];
      if (c.op === "arc") {
        const id = c.args[0] === 0 && c.args[1] === 0 ? "lit.md" : "dim.md";
        alphaAt[id] = current;
      }
    }
    expect(alphaAt["lit.md"]).toBe(1);
    expect(alphaAt["dim.md"]).toBeLessThan(1);
  });

  it("좌표가 없는 노드와 그 끝점을 가진 엣지는 던지지 않고 건너뛴다", () => {
    const { ctx, calls } = createStubCtx();
    const pending = node("pending.md"); // x·y 없음
    const ready = node("ready.md", 5, 5);
    const badEdge: SimEdge = { source: pending, target: ready };

    expect(() =>
      draw(ctx, 100, 100, scene({ nodes: [pending, ready], edges: [badEdge] })),
    ).not.toThrow();

    // pending 은 arc 가 없고, badEdge 는 끝점이 없어 stroke 까지 못 간다.
    expect(calls.filter((c) => c.op === "arc")).toHaveLength(1);
    expect(calls.some((c) => c.op === "stroke")).toBe(false);
  });
});
