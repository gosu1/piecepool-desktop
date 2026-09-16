import { IS_MAC } from "../bridge.ts";
import { WINDOW_CONTROLS_WIDTH } from "./WindowControls.tsx";
import { useWorkspace } from "../store/workspace.ts";

/**
 * 본문 영역 위의 탭 줄. 오른쪽 빈 공간은 일부러 비워 둔다 —
 * 거기가 창을 끄는 자리다(app-no-drag 를 붙이지 않는다).
 */
export function TabStrip() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTab = useWorkspace((s) => s.activeTab);
  const focusTab = useWorkspace((s) => s.focusTab);
  const closeTab = useWorkspace((s) => s.closeTab);

  if (tabs.length === 0) return null;

  return (
    <div
      // macOS 는 우리 버튼을 안 그린다(OS 신호등이 왼쪽 위에 있다) — 비울 것이 없다.
      style={{ paddingRight: IS_MAC ? 0 : WINDOW_CONTROLS_WIDTH }}
      className="flex h-8 shrink-0 items-stretch border-b border-hairline bg-chrome"
    >
      {tabs.map((t) => {
        const active = t.id === activeTab;
        return (
          <div
            key={t.id}
            className={`app-no-drag relative z-10 flex min-w-0 max-w-[200px] items-center border-r border-hairline ${
              active ? "bg-canvas text-ink" : "text-ink-muted hover:bg-fill-subtle"
            }`}
          >
            <button
              type="button"
              onClick={() => focusTab(t.id)}
              aria-current={active ? "true" : undefined}
              className="min-w-0 flex-1 truncate px-3 text-left text-sm"
            >
              {t.title}
            </button>
            <button
              type="button"
              onClick={() => closeTab(t.id)}
              aria-label={`${t.title} 닫기`}
              className="app-no-drag grid h-8 w-7 shrink-0 place-items-center text-ink-faint hover:text-ink"
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
