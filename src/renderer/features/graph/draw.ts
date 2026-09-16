import type { NotePath } from "../../../shared/types.ts";
import type { SimEdge, SimNode } from "./layout.ts";
import { radiusOf } from "./layout.ts";
import type { View } from "./hit.ts";

/** 색 묶음. GraphView 가 --ds-* 토큰을 읽어 넘긴다 — 여기서 색을 하드코딩하지 않는다. */
export interface Palette {
  node: string;
  active: string;
  edge: string;
  label: string;
}

/** 라벨이 드러나는 줌 문턱. 평소에는 구조만 보인다. */
export const LABEL_ZOOM = 1.1;

/** 강조 밖의 것에 남기는 불투명도. */
const DIM_NODE = 0.2;
const DIM_EDGE = 0.12;

export interface Scene {
  nodes: SimNode[];
  edges: SimEdge[];
  view: View;
  palette: Palette;
  /** 활성 노트. 트리·탭에서 고른 것이다. */
  active: NotePath | null;
  /** 지금 가리킨 노드와 그 이웃. hover 가 없으면 비어 있다. */
  lit: Set<NotePath>;
}

export function draw(ctx: CanvasRenderingContext2D, w: number, h: number, s: Scene): void {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(s.view.panX, s.view.panY);
  ctx.scale(s.view.zoom, s.view.zoom);

  const dim = s.lit.size > 0;

  // 엣지 먼저 — 노드가 그 위에 얹힌다.
  // 선 굵기를 줌으로 나눈다. 안 하면 확대할수록 선이 굵어져 그래프가 뭉갠다.
  ctx.lineWidth = 1 / s.view.zoom;
  ctx.strokeStyle = s.palette.edge;
  for (const e of s.edges) {
    const a = e.source as SimNode;
    const b = e.target as SimNode;
    // 손으로 만든 SimNode 방어용 가드.
    if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) continue;
    ctx.globalAlpha = !dim || (s.lit.has(a.id) && s.lit.has(b.id)) ? 1 : DIM_EDGE;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  const zoomed = s.view.zoom >= LABEL_ZOOM;
  ctx.font = `${11 / s.view.zoom}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  for (const n of s.nodes) {
    // 노드도 마찬가지.
    if (n.x === undefined || n.y === undefined) continue;
    const on = !dim || s.lit.has(n.id);
    ctx.globalAlpha = on ? 1 : DIM_NODE;

    const r = radiusOf(n.degree);
    ctx.fillStyle = n.id === s.active ? s.palette.active : s.palette.node;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
    ctx.fill();

    // 확대했거나, 지금 가리킨 무리에 들었을 때만 이름이 나온다.
    if (zoomed || (dim && s.lit.has(n.id))) {
      ctx.fillStyle = s.palette.label;
      ctx.fillText(n.title, n.x, n.y + r + 2 / s.view.zoom);
    }
  }

  ctx.restore();
  ctx.globalAlpha = 1;
}
