import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { bridge } from "../../bridge.ts";
import { useWorkspace } from "../../store/workspace.ts";
import { adjacency, buildLayout } from "./layout.ts";
import type { Layout, SimNode } from "./layout.ts";
import { draw } from "./draw.ts";
import type { Palette } from "./draw.ts";
import { hitNode, toWorld } from "./hit.ts";
import type { View } from "./hit.ts";
import type { GraphData, NotePath } from "../../../shared/types.ts";

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
/** 이만큼 안 움직이면 드래그가 아니라 클릭이다. */
const CLICK_SLOP = 3;

/** hover 가 없을 때 넘기는 빈 집합. 프레임마다 새로 만들지 않는다. */
const NOTHING_LIT = new Set<NotePath>();

/** --ds-* 토큰을 읽는다. 색을 하드코딩하면 테마가 바뀔 때 따라오지 않는다. */
function readPalette(el: HTMLElement): Palette {
  const cs = getComputedStyle(el);
  return {
    node: cs.getPropertyValue("--ds-ink-2").trim(),
    active: cs.getPropertyValue("--ds-primary").trim(),
    edge: cs.getPropertyValue("--ds-hairline").trim(),
    label: cs.getPropertyValue("--ds-ink-muted").trim(),
  };
}

/**
 * 볼트 전체의 [[링크]] 그래프.
 *
 * 좌표·변환·hover 는 전부 ref 에 둔다 — 상태로 두면 프레임마다 리렌더가 돈다.
 * 화면에 글자로 나가는 것(상태 문구)만 useState 다.
 */
export function GraphView() {
  const openTab = useWorkspace((s) => s.openTab);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const adjRef = useRef(new Map<NotePath, Set<NotePath>>());
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const hoverRef = useRef<NotePath | null>(null);
  const dragRef = useRef<{ node: SimNode | null; x: number; y: number; moved: boolean } | null>(
    null,
  );
  /** load() 호출 세대. openTab 의 seq 와 같은 역할 — 낡은 응답이 새 레이아웃을 못 짓게 막는다. */
  const genRef = useRef(0);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    layoutRef.current?.sim.stop();
    layoutRef.current = null;

    // 이 호출의 세대를 찜해 둔다. await 도중 언마운트되거나 StrictMode 가 다시 돌면
    // genRef 가 앞서 나가고, 그러면 이 호출은 아래에서 자신이 낡았음을 안다.
    const gen = ++genRef.current;

    let g: GraphData;
    try {
      const r = await bridge?.buildGraph();
      if (gen !== genRef.current) return;
      if (r === undefined) {
        setStatus("error");
        setMessage("앱 내부 연결이 끊겼다");
        return;
      }
      if (!r.ok) {
        setStatus("error");
        setMessage(r.error.message);
        return;
      }
      g = r.value;
    } catch (e) {
      if (gen !== genRef.current) return;
      setStatus("error");
      setMessage(`앱 내부 연결이 끊겼다: ${String(e)}`);
      return;
    }

    const host = hostRef.current;
    layoutRef.current = buildLayout(g, host?.clientWidth ?? 800, host?.clientHeight ?? 600);
    adjRef.current = adjacency(g);
    if (host !== null) paletteRef.current = readPalette(host);
    viewRef.current = { zoom: 1, panX: 0, panY: 0 };
    hoverRef.current = null;
    setMessage(`${g.nodes.length}개 노트 · ${g.edges.length}개 연결`);
    setStatus("ready");
  }, []);

  useEffect(() => {
    void load();
    // 탭을 떠나면 시뮬을 세운다. 안 세우면 안 보이는 캔버스에 계속 힘을 푼다.
    // sim.stop() 은 this 를 돌려주므로 () => sim.stop() 은 Destructor 타입(void 만 허용)에 안 맞는다 — 블록으로 버린다.
    return () => {
      // 세대를 먼저 올려 진행 중인 load() 를 무효화한다 — 그래야 언마운트 후
      // 늦게 도착한 응답이 아무도 세우지 않을 시뮬레이션을 새로 짓지 않는다.
      genRef.current++;
      layoutRef.current?.sim.stop();
    };
  }, [load]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const cv = canvasRef.current;
      const host = hostRef.current;
      const lay = layoutRef.current;
      const palette = paletteRef.current;
      if (cv === null || host === null || lay === null || palette === null) return;

      // 백버퍼를 DPR 로 키운다. 안 하면 고DPI 에서 흐려진다.
      const dpr = window.devicePixelRatio || 1;
      const w = host.clientWidth;
      const h = host.clientHeight;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (cv.width !== bw || cv.height !== bh) {
        cv.width = bw;
        cv.height = bh;
      }

      const ctx = cv.getContext("2d");
      if (ctx === null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const hover = hoverRef.current;
      draw(ctx, w, h, {
        nodes: lay.nodes,
        edges: lay.edges,
        view: viewRef.current,
        palette,
        // 프레임마다 스토어에서 직접 읽는다. 구독하면 트리 선택이 바뀔 때마다
        // 리렌더가 도는데, 그릴 사람은 이 루프라 얻는 것이 없다.
        active: useWorkspace.getState().selected,
        lit:
          hover === null
            ? NOTHING_LIT
            : new Set<NotePath>([hover, ...(adjRef.current.get(hover) ?? [])]),
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  /** 캔버스 좌상단 기준 좌표. clientX 를 그대로 쓰면 사이드바 너비만큼 밀린다. */
  const local = (e: { clientX: number; clientY: number }, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    const v = viewRef.current;
    const { sx, sy } = local(e, e.currentTarget);
    const before = toWorld(v, sx, sy);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY / 400)));
    // 커서 아래의 점이 제자리에 있도록 pan 을 되민다.
    viewRef.current = { zoom, panX: sx - before.x * zoom, panY: sy - before.y * zoom };
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const lay = layoutRef.current;
    if (lay === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { sx, sy } = local(e, e.currentTarget);
    const node = hitNode(lay.nodes, viewRef.current, sx, sy);
    if (node !== null) {
      // 잡은 노드를 손가락에 고정하고 시뮬을 재가열한다.
      lay.sim.alphaTarget(0.3).restart();
      node.fx = node.x;
      node.fy = node.y;
    }
    dragRef.current = { node, x: sx, y: sy, moved: false };
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const lay = layoutRef.current;
    if (lay === null) return;
    const { sx, sy } = local(e, e.currentTarget);
    const d = dragRef.current;

    if (d === null) {
      hoverRef.current = hitNode(lay.nodes, viewRef.current, sx, sy)?.id ?? null;
      return;
    }

    if (Math.abs(sx - d.x) + Math.abs(sy - d.y) > CLICK_SLOP) d.moved = true;

    if (d.node !== null) {
      const w = toWorld(viewRef.current, sx, sy);
      d.node.fx = w.x;
      d.node.fy = w.y;
    } else {
      const v = viewRef.current;
      viewRef.current = { zoom: v.zoom, panX: v.panX + (sx - d.x), panY: v.panY + (sy - d.y) };
      d.x = sx;
      d.y = sy;
    }
  };

  /** 포인터가 캔버스를 벗어나면 pointermove 가 더 안 온다 — 안 지우면 마지막 hover 가 영영 남는다. */
  const onLeave = () => {
    hoverRef.current = null;
  };

  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const lay = layoutRef.current;
    const d = dragRef.current;
    // 상태를 먼저 되돌린다 — releasePointerCapture 는 pointerCancel 이 만드는
    // 상황에서 throw 할 수 있고, 뒤에 두면 드래그가 무장 상태로 남는다.
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (lay === null || d === null) return;

    lay.sim.alphaTarget(0);
    if (d.node === null) return;

    // 놓으면 다시 물리에 맡긴다. 못 박아 두면 그래프가 조금씩 굳는다.
    d.node.fx = null;
    d.node.fy = null;
    if (!d.moved) void openTab(d.node.id, d.node.title);
  };

  return (
    <div ref={hostRef} className="relative min-h-0 flex-1 overflow-hidden">
      <canvas
        ref={canvasRef}
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onLeave}
        className="block h-full w-full"
      />

      <div className="absolute left-3 top-3 flex items-center gap-2 text-xs text-ink-muted">
        <button
          type="button"
          onClick={() => void load()}
          disabled={status === "loading"}
          className="rounded border border-hairline bg-chrome px-2 py-1 hover:bg-fill-subtle disabled:opacity-60"
        >
          새로고침
        </button>
        {status === "ready" && <span>{message}</span>}
        {status === "loading" && <span>읽는 중…</span>}
      </div>

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-danger">
          {message}
        </div>
      )}
    </div>
  );
}
