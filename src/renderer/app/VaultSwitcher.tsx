import { useWorkspace } from "../store/workspace.ts";

/**
 * 사이드바 하단 고정. 옵시디언의 볼트 전환기 자리다.
 * 볼트가 없을 때도 같은 자리에서 같은 동작을 한다 — 진입점을 둘로 나누지 않는다.
 */
export function VaultSwitcher() {
  const vault = useWorkspace((s) => s.vault);
  const loading = useWorkspace((s) => s.loading);
  const pickVault = useWorkspace((s) => s.pickVault);

  return (
    <button
      type="button"
      onClick={() => void pickVault()}
      disabled={loading}
      aria-label={vault ? `볼트 바꾸기 (현재 ${vault.name})` : "폴더 열기"}
      className="flex h-9 shrink-0 items-center gap-2 border-t border-hairline px-3 text-left text-sm text-ink-2 hover:bg-fill-subtle disabled:opacity-60"
    >
      <svg
        aria-hidden="true"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        className="shrink-0 text-ink-faint"
      >
        <path d="M3 4.5 6 1.5 9 4.5M3 7.5 6 10.5 9 7.5" />
      </svg>
      <span className="truncate">{vault ? vault.name : "폴더 열기"}</span>
    </button>
  );
}
