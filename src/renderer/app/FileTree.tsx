import { useWorkspace, type TreeNode } from "../store/workspace.ts";

function Row({ node, depth }: { node: TreeNode; depth: number }) {
  const isDir = node.kind === "dir";
  const expanded = useWorkspace((s) => s.expanded.has(node.path));
  const selected = useWorkspace((s) => s.selected === node.path);
  const toggleFolder = useWorkspace((s) => s.toggleFolder);
  const select = useWorkspace((s) => s.select);

  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? toggleFolder(node.path) : select(node.path))}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`flex h-6 w-full items-center gap-1 pr-2 text-left text-sm ${
          selected ? "bg-fill-subtle text-ink" : "text-ink-2 hover:bg-fill-subtle"
        }`}
      >
        <span className="w-3 shrink-0 text-ink-faint">{isDir ? (expanded ? "▾" : "▸") : ""}</span>
        <span className="truncate">{node.name}</span>
      </button>

      {isDir &&
        expanded &&
        node.children?.map((child) => <Row key={child.path} node={child} depth={depth + 1} />)}
    </>
  );
}

export function FileTree() {
  const tree = useWorkspace((s) => s.tree);

  return (
    <div className="flex-1 overflow-y-auto pb-2">
      {tree.map((node) => (
        <Row key={node.path} node={node} depth={0} />
      ))}
    </div>
  );
}
