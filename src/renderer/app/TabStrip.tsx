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
      // 탭이 넘치면 가로로 스크롤한다. 스크롤바가 나오면 32px 안에서 탭이 잘리므로 숨긴다.
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline bg-chrome px-1 [scrollbar-width:none]"
    >
      {tabs.map((t) => {
        const active = t.id === activeTab;
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
              onClick={() => focusTab(t.id)}
              aria-current={active ? "true" : undefined}
              className="min-w-0 flex-1 truncate px-2 text-left text-sm"
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
