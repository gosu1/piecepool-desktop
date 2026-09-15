import { create } from "zustand";
import type { NotePath, Result } from "../../shared/types.ts";
import type { TreeNode, VaultPayload } from "../../shared/ipc.ts";

// FileTree.tsx 가 스토어에서 TreeNode 를 가져다 쓴다. 그 import 를 살려 둔다.
export type { TreeNode };

export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
export const RIBBON_WIDTH = 48;

export function clampWidth(px: number): number {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, px));
}

interface WorkspaceState {
  /** 열린 볼트. 없으면 아직 폴더를 고르지 않은 것이다. */
  vault: VaultPayload | null;
  tree: TreeNode[];
  /** 읽기 실패 메시지. 빈 볼트와 읽기 실패는 다른 상태다. */
  error: string | null;
  loading: boolean;
  expanded: Set<NotePath>;
  selected: NotePath | null;
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleFolder: (path: NotePath) => void;
  select: (path: NotePath) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (px: number) => void;
  pickVault: () => Promise<void>;
  loadLastVault: () => Promise<void>;
}

/** 두 액션이 같은 응답 모양을 받는다. 해석을 한 곳에 둔다. */
export function applied(r: Result<VaultPayload | null>): Partial<WorkspaceState> {
  if (!r.ok) return { error: r.error.message, loading: false };
  // null 은 취소이거나 기억된 볼트가 없는 것이다 — 둘 다 아무 일도 일어나지 않는다.
  if (r.value === null) return { loading: false };
  return {
    vault: r.value,
    tree: r.value.tree,
    expanded: new Set(),
    selected: null,
    error: null,
    loading: false,
  };
}

/** IPC 자체가 끊긴 경우(preload 부재 등). Result 로 오지 않으므로 여기서 잡는다. */
async function call(
  fn: () => Promise<Result<VaultPayload | null>>,
): Promise<Partial<WorkspaceState>> {
  try {
    return applied(await fn());
  } catch (e) {
    return { error: `앱 내부 연결이 끊겼다: ${String(e)}`, loading: false };
  }
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  vault: null,
  tree: [],
  error: null,
  loading: false,
  expanded: new Set(),
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

  pickVault: async () => {
    set({ loading: true, error: null });
    set(await call(() => window.piecepool.pickVault()));
  },

  loadLastVault: async () => {
    set({ loading: true, error: null });
    set(await call(() => window.piecepool.lastVault()));
  },
}));
