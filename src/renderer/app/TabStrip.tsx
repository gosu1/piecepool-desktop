import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { IS_MAC } from "../bridge.ts";
import { WINDOW_CONTROLS_WIDTH } from "./WindowControls.tsx";
import { useWorkspace } from "../store/workspace.ts";
import { useDrag } from "../features/split/drag.ts";

/** 이만큼 안 움직이면 드래그가 아니라 클릭이다. GraphView 와 같은 값이다. */
const CLICK_SLOP = 3;

/**
 * 한 칸의 탭 줄. 오른쪽 빈 공간은 일부러 비워 둔다 —
 * 거기가 창을 끄는 자리다(app-no-drag 를 붙이지 않는다).
 */
export function TabStrip({ pane }: { pane: number }) {
  // 칸을 통째로 받는다. s.panes[pane]?.tabs ?? [] 처럼 쓰면 호출마다 새 배열이 나와
  // Object.is 비교가 늘 실패하고 무한 리렌더가 된다.
  const p = useWorkspace((s) => s.panes[pane]);
  // 창 조작 버튼은 오른쪽 끝에만 있다 — 마지막 칸만 자리를 비운다.
  const last = useWorkspace((s) => pane === s.panes.length - 1);
  const focusTab = useWorkspace((s) => s.focusTab);
  const closeTab = useWorkspace((s) => s.closeTab);
  const moveTabToPane = useWorkspace((s) => s.moveTabToPane);
  /** 눌린 탭. moved 가 false 인 동안에는 아직 클릭일 수 있다. */
  const pressRef = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pressRef.current = { id, x: e.clientX, y: e.clientY, moved: false };
  };

  const onMove = (e: ReactPointerEvent<HTMLButtonElement>, title: string) => {
    const d = pressRef.current;
    if (d === null) return;

    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < CLICK_SLOP && Math.abs(e.clientY - d.y) < CLICK_SLOP) return;
      // 본문 영역은 드래그 시작 때 한 번만 잰다(설계 §5). main 은 두 칸을 함께 덮는다.
      const main = e.currentTarget.closest("main");
      if (main === null) return;
      const r = main.getBoundingClientRect();
      d.moved = true;
      useDrag.getState().start({ id: d.id, title }, { left: r.left, width: r.width });
    }

    useDrag.getState().move(e.clientX, e.clientY, useWorkspace.getState().panes.length);
  };

  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    // 상태를 먼저 되돌린다: releasePointerCapture 는 더 이상 활성 포인터가 아닐 때
    // NotFoundError 를 던질 수 있는데, 뒤에 두면 핸들러가 무장 상태로 남는다(ResizeHandle 과 같은 이유).
    const d = pressRef.current;
    pressRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (d === null) return;

    if (!d.moved) {
      focusTab(d.id);
      return;
    }

    const { zone, end } = useDrag.getState();
    end();
    if (zone !== null) moveTabToPane(d.id, zone);
  };

  const onCancel = () => {
    // 창 밖으로 나가거나 제스처가 취소된 것이다. 아무것도 옮기지 않는다.
    pressRef.current = null;
    useDrag.getState().end();
  };

  if (p === undefined || p.tabs.length === 0) return null;

  return (
    <div
      // macOS 는 우리 버튼을 안 그린다(OS 신호등이 왼쪽 위에 있다) — 비울 것이 없다.
      style={{ paddingRight: IS_MAC || !last ? 0 : WINDOW_CONTROLS_WIDTH }}
      // 탭이 넘치면 가로로 스크롤한다. 스크롤바가 나오면 32px 안에서 탭이 잘리므로 숨긴다.
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline bg-chrome px-1 [scrollbar-width:none]"
    >
      {p.tabs.map((t) => {
        const active = t.id === p.activeTab;
        return (
          <div
            key={t.id}
            // 제목 길이와 무관하게 모든 탭이 같은 폭이다. 줄어들면 폭이 흔들리므로 shrink-0.
            className={`app-no-drag relative z-10 flex h-6 w-40 shrink-0 items-center rounded-md ${
              active ? "bg-canvas text-ink" : "text-ink-muted hover:bg-fill-subtle"
            }`}
          >
            <button
              type="button"
              onPointerDown={(e) => onDown(e, t.id)}
              onPointerMove={(e) => onMove(e, t.title)}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              aria-current={active ? "true" : undefined}
              // 드래그 중에 제목이 글자 선택으로 파래지는 것을 막는다.
              className="min-w-0 flex-1 select-none truncate px-2 text-left text-sm"
            >
              {t.title}
            </button>
            <button
              type="button"
              onClick={() => closeTab(t.id)}
              aria-label={`${t.title} 닫기`}
              className="app-no-drag mr-1 grid h-5 w-5 shrink-0 place-items-center rounded text-ink-faint hover:bg-fill-subtle hover:text-ink"
            >
              <svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" strokeWidth="1.2">
                <path d="M1 1l6 6M7 1l-6 6" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
