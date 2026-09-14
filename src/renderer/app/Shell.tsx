import { useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Ribbon } from "./Ribbon.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { RIBBON_WIDTH, useWorkspace } from "../store/workspace.ts";

function ResizeHandle() {
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
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      className="w-1 shrink-0 cursor-col-resize hover:bg-primary"
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
