import { IS_MAC } from "../bridge.ts";
import { RIBBON_WIDTH, useWorkspace } from "../store/workspace.ts";

/** 좌측 아이콘 바. 동작하는 아이콘은 사이드바 토글 하나뿐이다. */
export function Ribbon() {
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);

  return (
    <nav
      aria-label="리본"
      style={{ width: RIBBON_WIDTH }}
      className={`relative z-10 flex shrink-0 flex-col items-center gap-1 border-r border-hairline bg-chrome ${
        // macOS 는 왼쪽 위에 OS 신호등이 있다. 첫 버튼을 그 아래로 내린다.
        IS_MAC ? "pt-10" : "pt-2"
      }`}
    >
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={sidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
        className="app-no-drag grid h-8 w-8 place-items-center rounded text-ink-muted hover:bg-fill-subtle hover:text-ink"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
        </svg>
      </button>
    </nav>
  );
}
