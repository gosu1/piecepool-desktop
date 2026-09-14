import { FileTree } from "./FileTree.tsx";
import { useWorkspace } from "../store/workspace.ts";

export function Sidebar() {
  const width = useWorkspace((s) => s.sidebarWidth);

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-r border-hairline bg-chrome">
      <header className="flex h-9 shrink-0 items-center px-3 text-xs font-medium text-ink-muted">
        파일 탐색기
      </header>
      <FileTree />
    </aside>
  );
}
