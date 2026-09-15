import { FileTree } from "./FileTree.tsx";
import { VaultSwitcher } from "./VaultSwitcher.tsx";
import { useWorkspace } from "../store/workspace.ts";

export function Sidebar() {
  const width = useWorkspace((s) => s.sidebarWidth);
  const vault = useWorkspace((s) => s.vault);
  const error = useWorkspace((s) => s.error);

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-r border-hairline bg-chrome">
      <header className="flex h-9 shrink-0 items-center px-3 text-xs font-medium text-ink-muted">
        {vault ? vault.name : "파일 탐색기"}
      </header>

      {error !== null ? (
        <div className="flex-1 overflow-y-auto px-3 text-sm text-danger">{error}</div>
      ) : vault === null ? (
        <div className="flex-1 px-3 text-sm text-ink-muted">폴더를 열면 노트가 여기 보인다.</div>
      ) : (
        <FileTree />
      )}

      <VaultSwitcher />
    </aside>
  );
}
