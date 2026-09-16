import type { SimNode } from "./layout.ts";
import { radiusOf } from "./layout.ts";

/** 캔버스 변환. 그리기와 히트 테스트가 반드시 같은 값을 본다. */
export interface View {
  zoom: number;
  panX: number;
  panY: number;
}

/** 화면 좌표 → 시뮬 좌표. draw 가 거는 translate·scale 의 역이다. */
export function toWorld(v: View, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
}

/**
 * 화면 좌표 아래의 노드. 없으면 null.
 * 겹치면 나중에 그려진 것이 위에 있으므로 배열 뒤에서부터 본다.
 */
export function hitNode(nodes: SimNode[], v: View, sx: number, sy: number): SimNode | null {
  const { x, y } = toWorld(v, sx, sy);
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    // 첫 tick 전에는 좌표가 없다.
    if (n.x === undefined || n.y === undefined) continue;
    // 작은 노드를 누르기 쉽도록 2px 여유를 준다.
    const r = radiusOf(n.degree) + 2;
    if ((n.x - x) ** 2 + (n.y - y) ** 2 <= r * r) return n;
  }
  return null;
}
