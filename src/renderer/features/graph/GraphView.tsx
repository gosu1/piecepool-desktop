import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { bridge } from "../../bridge.ts";
import { useWorkspace } from "../../store/workspace.ts";
import { buildLayout, recenter } from "./layout.ts";
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
 *
 * hidden 인 동안에도 마운트는 유지된다(NoteView.tsx) — 탭을 오가도 배치와 pan/zoom 을
 * 잃지 않기 위해서다. 실제로 안 그리는 것은 rAF 루프 안의 가드 하나로 충분하다.
 */
export function GraphView({ hidden }: { hidden: boolean }) {
  const openTab = useWorkspace((s) => s.openTab);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const paletteRef = useRef<Palette | null>(null);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const hoverRef = useRef<NotePath | null>(null);
  const dragRef = useRef<{ node: SimNode | null; x: number; y: number; moved: boolean } | null>(
    null,
  );
  /** load() 호출 세대. openTab 의 seq 와 같은 역할 — 낡은 응답이 새 레이아웃을 못 짓게 막는다. */
  const genRef = useRef(0);
  /** rAF 루프가 매 프레임 읽는 최신 hidden 값. prop 을 직접 읽으면 루프를 다시 걸어야 한다. */
  const hiddenRef = useRef(hidden);

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
    if (host !== null) paletteRef.current = readPalette(host);
    viewRef.current = { zoom: 1, panX: 0, panY: 0 };
    hoverRef.current = null;
    setMessage(`${g.nodes.length}개 노트 · ${g.edges.length}개 연결`);
    setStatus("ready");
  }, []);

  useEffect(() => {
    void load();
    // 이 컴포넌트는 그래프 탭이 있는 한 hidden 으로만 바뀌고 마운트는 유지된다
    // (NoteView.tsx) — 여기서 세우는 것은 탭을 "닫아" 진짜 언마운트될 때뿐이다.
    // 탭을 잠깐 떠나는 동안에도 시뮬은 계속 돌아 배치를 지킨다(hidden 이면 rAF 가 안 그릴 뿐이다).
    // sim.stop() 은 this 를 돌려주므로 () => sim.stop() 은 Destructor 타입(void 만 허용)에 안 맞는다 — 블록으로 버린다.
    return () => {
      // 세대를 먼저 올려 진행 중인 load() 를 무효화한다 — 그래야 언마운트 후
      // 늦게 도착한 응답이 아무도 세우지 않을 시뮬레이션을 새로 짓지 않는다.
      genRef.current++;
      layoutRef.current?.sim.stop();
    };
  }, [load]);

  // 매 프레임 읽는 hiddenRef 를 최신 prop 값으로 맞춘다 — 루프 자체는 다시 걸지 않는다.
  useEffect(() => {
    hiddenRef.current = hidden;
  }, [hidden]);

  // 칸이 갈라지거나 창 크기가 바뀌면 host 폭이 달라진다. 캔버스 백버퍼는 rAF 루프가
  // 매 프레임 다시 잡지만 **중심 힘은 buildLayout 때 박힌 값 그대로**라, 안 옮기면
  // 그래프가 옛 중심에 뭉쳐 화면 밖으로 밀린다.
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const ro = new ResizeObserver(() => {
      const lay = layoutRef.current;
      // hidden 인 host 는 clientWidth/Height 가 0 이다 — 그 값으로 중심을 옮기면
      // 노드가 한 점으로 빨려 들어간다. 다시 보일 때 관찰자가 실제 크기로 한 번 더 부른다.
      if (lay === null || host.clientWidth === 0 || host.clientHeight === 0) return;
      recenter(lay, host.clientWidth, host.clientHeight);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // display:none 인 host 는 clientWidth/Height 가 0 이다 — 그 값으로 백버퍼를 키우면
      // 캔버스가 0×0 이 되어 다음에 보일 때 그림이 사라진다. 읽기 전에 막는다.
      if (hiddenRef.current) return;
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
          hover === null ? NOTHING_LIT : new Set<NotePath>([hover, ...(lay.adj.get(hover) ?? [])]),
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
    <div
      ref={hostRef}
      // hidden 이면 display:none — rAF 가드(위)와 짝을 이뤄 안 보이는 캔버스를 0×0 으로 만들지 않는다.
      className={`relative min-h-0 flex-1 overflow-hidden ${hidden ? "hidden" : ""}`}
    >
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
