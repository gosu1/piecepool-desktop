import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Ribbon } from "./Ribbon.tsx";
import { Sidebar } from "./Sidebar.tsx";
import {
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  RIBBON_WIDTH,
  useWorkspace,
} from "../store/workspace.ts";

const SIDEBAR_WIDTH_KEY_STEP = 16;

function ResizeHandle() {
  const sidebarWidth = useWorkspace((s) => s.sidebarWidth);
  const setSidebarWidth = useWorkspace((s) => s.setSidebarWidth);
  const [dragging, setDragging] = useState(false);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 포인터 캡처 중에도 이벤트가 계속 오므로 dragging 으로 직접 막는다.
    if (dragging) setSidebarWidth(e.clientX - RIBBON_WIDTH);
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 상태를 먼저 되돌린다: releasePointerCapture 는 pointerCancel 이 만드는
    // 상황(더 이상 활성 포인터가 아님)에서 NotFoundError 를 던질 수 있는데,
    // 뒤에 두면 그때 setDragging(false) 가 실행되지 않아 핸들이 계속 무장 상태로 남는다.
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSidebarWidth(sidebarWidth - SIDEBAR_WIDTH_KEY_STEP);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setSidebarWidth(sidebarWidth + SIDEBAR_WIDTH_KEY_STEP);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={sidebarWidth}
      aria-valuemin={MIN_SIDEBAR_WIDTH}
      aria-valuemax={MAX_SIDEBAR_WIDTH}
      tabIndex={0}
      aria-label="사이드바 너비"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onKeyDown={onKeyDown}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary focus-visible:bg-primary focus-visible:outline-none"
    />
  );
}

export function Shell() {
  const selected = useWorkspace((s) => s.selected);
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);

  return (
    <div className="flex h-full bg-canvas text-ink">
      <Ribbon />
      {sidebarOpen && (
        <>
          <Sidebar />
          <ResizeHandle />
        </>
      )}
      <main className="grid flex-1 place-items-center text-sm text-ink-muted">
        {selected ?? "선택된 파일 없음"}
      </main>
    </div>
  );
}
