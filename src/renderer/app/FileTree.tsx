import { useWorkspace, type TreeNode } from "../store/workspace.ts";

function Row({ node, depth }: { node: TreeNode; depth: number }) {
  const isDir = node.kind === "dir";
  // .md 만 보여주므로 확장자가 정보를 주지 않는다. path 는 .md 를 유지한다.
  const label = isDir ? node.name : node.name.replace(/\.md$/i, "");
  const expanded = useWorkspace((s) => s.expanded.has(node.path));
  const selected = useWorkspace((s) => s.selected === node.path);
  const toggleFolder = useWorkspace((s) => s.toggleFolder);
  const select = useWorkspace((s) => s.select);

  return (
    <>
      <button
        type="button"
        onClick={() => (isDir ? toggleFolder(node.path) : select(node.path))}
        aria-expanded={isDir ? expanded : undefined}
        aria-current={!isDir && selected ? "true" : undefined}
        style={{ paddingLeft: 8 + depth * 14 }}
        className={`flex h-6 w-full items-center gap-1 pr-2 text-left text-sm ${
          selected ? "bg-fill-subtle text-ink" : "text-ink-2 hover:bg-fill-subtle"
        }`}
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-ink-faint">
          {isDir ? (expanded ? "▾" : "▸") : ""}
        </span>
        <span className="truncate">{label}</span>
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
