import { useIngest } from "../store/ingest.ts";
import { useWorkspace } from "../store/workspace.ts";

/**
 * 오른쪽 아래 한 줄. 정리가 끝났을 때만 뜬다 — OS 알림과 같은 내용이고, 알림을 못 봤어도 여기 남는다.
 * 누르면 정리 탭이 열린다. 닫기 전까지 사라지지 않는다 — 몇십 분 걸린 일의 결과라 놓치면 안 된다.
 */
export function Toast() {
  const toast = useIngest((s) => s.toast);
  const dismiss = useIngest((s) => s.dismissToast);
  const openIngestTab = useWorkspace((s) => s.openIngestTab);
  if (toast === null) return null;
  return (
    <div
      role="status"
      className="absolute right-4 bottom-4 z-20 flex items-center gap-3 rounded-md border border-hairline bg-surface-soft px-3 py-2 text-sm text-ink shadow-lg"
    >
      <button type="button" onClick={openIngestTab} className="hover:underline">
        정리 끝 — {toast.text}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="닫기"
        className="text-ink-muted hover:text-ink"
      >
        ×
      </button>
    </div>
  );
}
