import { FileTree } from "./FileTree.tsx";
import { VaultSwitcher } from "./VaultSwitcher.tsx";
import { useWorkspace } from "../store/workspace.ts";

export function Sidebar() {
  const width = useWorkspace((s) => s.sidebarWidth);
  const vault = useWorkspace((s) => s.vault);
  const error = useWorkspace((s) => s.error);

  return (
    <aside style={{ width }} className="flex shrink-0 flex-col border-r border-hairline bg-chrome">
      {/* 볼트 이름은 하단 전환기가 이미 보여 준다. 여기는 비워 두되 높이는 남긴다 —
          이 36px 이 트리 첫 행을 드래그 띠(상단 32px) 밖으로 밀어낸다. 지우면 첫 행이 안 눌린다. */}
      <div className="h-9 shrink-0" />

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
