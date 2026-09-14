import { Ribbon } from "./Ribbon.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { useWorkspace } from "../store/workspace.ts";

export function Shell() {
  const selected = useWorkspace((s) => s.selected);

  return (
    <div className="flex h-full bg-canvas text-ink">
      <Ribbon />
      <Sidebar />
      <main className="grid flex-1 place-items-center text-sm text-ink-muted">
        {selected ?? "선택된 파일 없음"}
      </main>
    </div>
  );
}
