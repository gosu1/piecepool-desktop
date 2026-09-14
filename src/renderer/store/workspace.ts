import { create } from "zustand";

export interface TreeNode {
  name: string;
  /** 볼트 루트 기준 상대경로. POSIX 구분자로 고정한다. */
  path: string;
  kind: "dir" | "file";
  children?: TreeNode[];
}

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
export const RIBBON_WIDTH = 48;

export function clampWidth(px: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, px));
}

/**
 * 목 데이터. 재구축 설계 §4.2 의 볼트 레이아웃을 그대로 흉내낸다 —
 * IPC 가 생기면 이 상수만 교체되고 UI 는 그대로다.
 */
const MOCK_TREE: TreeNode[] = [
  {
    name: "wiki",
    path: "wiki",
    kind: "dir",
    children: [
      { name: "트랜스포머.md", path: "wiki/트랜스포머.md", kind: "file" },
      { name: "어텐션.md", path: "wiki/어텐션.md", kind: "file" },
      {
        name: "논문",
        path: "wiki/논문",
        kind: "dir",
        children: [
          {
            name: "Attention Is All You Need.md",
            path: "wiki/논문/Attention Is All You Need.md",
            kind: "file",
          },
        ],
      },
    ],
  },
  {
    name: "inbox",
    path: "inbox",
    kind: "dir",
    children: [{ name: "2026-09-14 메모.md", path: "inbox/2026-09-14 메모.md", kind: "file" }],
  },
  {
    name: "sources",
    path: "sources",
    kind: "dir",
    children: [
      {
        name: "files",
        path: "sources/files",
        kind: "dir",
        children: [{ name: "attention.pdf", path: "sources/files/attention.pdf", kind: "file" }],
      },
    ],
  },
];

interface WorkspaceState {
  tree: TreeNode[];
  expanded: Set<string>;
  selected: string | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleFolder: (path: string) => void;
  select: (path: string) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  tree: MOCK_TREE,
  expanded: new Set(["wiki"]),
  selected: null,
  sidebarOpen: true,
  sidebarWidth: 240,

  toggleFolder: (path) =>
    set((s) => {
      // 새 Set 을 만든다. 그 자리에서 고치면 참조가 같아 리렌더가 안 걸린다.
      const next = new Set(s.expanded);
      if (!next.delete(path)) next.add(path);
      return { expanded: next };
    }),

  select: (path) => set({ selected: path }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (px) => set({ sidebarWidth: clampWidth(px) }),
}));
