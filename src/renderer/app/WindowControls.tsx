import { bridge, IS_MAC } from "../bridge.ts";

const BTN = "app-no-drag grid h-8 w-11 place-items-center text-ink-muted hover:text-ink";

/**
 * 최소화·최대화·닫기.
 *
 * macOS 에서는 그리지 않는다 — OS 신호등이 이미 왼쪽 위에 있어 둘 다 뜬다.
 * preload 가 없으면 부를 대상이 없으므로 역시 그리지 않는다.
 */
export function WindowControls() {
  // 지역 const 로 받는다 — 모듈 스코프 바인딩은 클로저 안에서 narrowing 이 풀린다.
  const api = bridge;
  if (api === undefined || IS_MAC) return null;

  return (
    <div className="absolute right-0 top-0 z-20 flex">
      <button
        type="button"
        onClick={() => api.minimizeWindow()}
        aria-label="최소화"
        className={`${BTN} hover:bg-fill-subtle`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
          <line x1="1" y1="5" x2="9" y2="5" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => api.toggleMaximizeWindow()}
        aria-label="최대화"
        className={`${BTN} hover:bg-fill-subtle`}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        >
          <rect x="1.5" y="1.5" width="7" height="7" />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => api.closeWindow()}
        aria-label="닫기"
        className={`${BTN} hover:bg-danger hover:text-on-primary`}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
          <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
