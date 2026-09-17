import type { ReactNode } from "react";
import { IS_MAC } from "../bridge.ts";
import { GRAPH_TAB_ID, QUERY_TAB_ID, RIBBON_WIDTH, useWorkspace } from "../store/workspace.ts";

/**
 * 리본 아이콘 하나.
 * `app-no-drag` 가 필요한 이유: 상단 32px 이 창을 끄는 띠라 안 붙이면 눌러도 창만 끌린다.
 * `relative z-10` 은 부모 <nav> 가 이미 갖고 있다.
 */
function RibbonButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-current={active === true ? "true" : undefined}
      className={`app-no-drag grid h-8 w-8 place-items-center rounded ${
        active === true
          ? "bg-fill-subtle text-ink"
          : "text-ink-muted hover:bg-fill-subtle hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** 좌측 아이콘 바. 사이드바 토글 · 그래프 · 쿼리 셋이다. */
export function Ribbon() {
  const sidebarOpen = useWorkspace((s) => s.sidebarOpen);
  const toggleSidebar = useWorkspace((s) => s.toggleSidebar);
  const openGraphTab = useWorkspace((s) => s.openGraphTab);
  const graphActive = useWorkspace((s) => s.panes.some((p) => p.activeTab === GRAPH_TAB_ID));
  const openQueryTab = useWorkspace((s) => s.openQueryTab);
  const queryActive = useWorkspace((s) => s.panes.some((p) => p.activeTab === QUERY_TAB_ID));

  return (
    <nav
      aria-label="리본"
      style={{ width: RIBBON_WIDTH }}
      className={`relative z-10 flex shrink-0 flex-col items-center gap-1 border-r border-hairline bg-chrome ${
        // macOS 는 왼쪽 위에 OS 신호등이 있다. 첫 버튼을 그 아래로 내린다.
        IS_MAC ? "pt-10" : "pt-2"
      }`}
    >
      <RibbonButton
        label={sidebarOpen ? "사이드바 접기" : "사이드바 펼치기"}
        onClick={toggleSidebar}
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
      </RibbonButton>

      <RibbonButton label="그래프" active={graphActive} onClick={openGraphTab}>
        {/* 구 레포 GraphIcon — 점 셋과 잇는 선. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        >
          <circle cx="4" cy="4.2" r="1.8" />
          <circle cx="12" cy="5" r="1.8" />
          <circle cx="8" cy="12" r="1.8" />
          <path d="M5.4 5.5 7.2 10.2M10.9 6.4 9 10.4M5.8 4.4h4.4" />
        </svg>
      </RibbonButton>

      <RibbonButton label="쿼리" active={queryActive} onClick={openQueryTab}>
        {/* 말풍선 + 말줄임 셋. 사이드바 아이콘도 사각형이라, 점 셋으로 갈라 둔다. */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
        >
          <rect x="1.5" y="2.5" width="13" height="9" rx="2" />
          <path d="M5 11.5v2.6l3-2.6" />
          <circle cx="5.5" cy="7" r="0.5" fill="currentColor" stroke="none" />
          <circle cx="8" cy="7" r="0.5" fill="currentColor" stroke="none" />
          <circle cx="10.5" cy="7" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      </RibbonButton>
    </nav>
  );
}
