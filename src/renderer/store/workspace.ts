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

/**
 * 상단 프론트매터 블록을 잘라낸다. YAML 을 이해하지 않는다 —
 * 첫 줄이 `---` 일 때 다음 `---` 줄까지만 버린다.
 *
 * hashes 같은 필드는 사용자가 쓴 글이 아니라 도구가 남긴 것이라 읽는 데 방해가 된다.
 * 닫히는 `---` 가 없으면 프론트매터가 아니므로 원문을 그대로 돌려준다.
 */
export function stripFrontmatter(raw: string): string {
  // CRLF 로 저장된 파일은 각 줄 끝에 \r 가 남는다 — 구분선 비교에서 그것을 떼지 않으면
  // "---\r" !== "---" 이라 Windows 에서 만든 노트는 프론트매터가 통째로 그대로 보인다.
  const lines = raw.split("\n");
  if (lines[0]?.trimEnd() !== "---") return raw;
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === "---");
  if (end === -1) return raw;
  // 닫는 --- 다음의 빈 줄들도 함께 버린다.
  let i = end + 1;
  while (lines[i]?.trimEnd() === "") i++;
  return lines.slice(i).join("\n");
}

/** 그래프 탭은 하나뿐이라 id 가 곧 상수다. */
export const GRAPH_TAB_ID = "graph";

/** 쿼리 탭도 하나뿐이다. 세션을 여럿 두는 것은 대화가 생긴 뒤의 일이다. */
export const QUERY_TAB_ID = "query";

/**
 * 탭 신원. NotePath 와 키 공간을 물리적으로 가른다 —
 * NotePath 는 string 별칭이라 `path | "graph"` 로는 타입이 충돌을 못 잡는다.
 */
export function noteTabId(p: NotePath): string {
  return `note:${p}`;
}

/** 열린 노트 탭 하나. 읽는 중에는 body·error 가 둘 다 null 이다. */
export interface NoteTab {
  kind: "note";
  id: string;
  path: NotePath;
  title: string;
  body: string | null;
  error: string | null;
  /** 이 탭을 연 요청의 세대. 응답이 자기 세대의 탭에만 담기게 한다. */
  seq: number;
}

/** 그래프 탭. 파일이 아니라 경로가 없다. */
export interface GraphTab {
  kind: "graph";
  id: "graph";
  title: "그래프";
}

/** 쿼리 세션 탭. 그래프처럼 경로가 없고, 아직 담는 상태도 없다. */
export interface QueryTab {
  kind: "query";
  id: "query";
  title: "쿼리";
}

export type Tab = NoteTab | GraphTab | QueryTab;

/** 탭 요청 세대. 닫았다가 곧바로 다시 연 탭에 옛 응답이 덮어쓰는 것을 막는다. */
let tabSeq = 0;

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
  tabs: Tab[];
  /** 활성 탭의 id. NotePath 가 아니다 — 파일이 아닌 탭이 있다. */
  activeTab: string | null;
  openTab: (path: NotePath, title: string) => Promise<void>;
  openGraphTab: () => void;
  openQueryTab: () => void;
  focusTab: (id: string) => void;
  closeTab: (id: string) => void;
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
    // 탭도 비운다. NotePath 는 볼트 루트 기준 상대경로라 새 볼트에서 다른 파일을 뜻한다 —
    // 남겨 두면 이전 볼트의 글이 새 볼트의 탭 제목을 달고 조용히 그대로 떠 있는다.
    tabs: [],
    activeTab: null,
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

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  vault: null,
  tree: [],
  error: null,
  loading: false,
  expanded: new Set(),
  selected: null,
  sidebarOpen: true,
  sidebarWidth: 240,
  tabs: [],
  activeTab: null,

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

  openTab: async (path, title) => {
    const id = noteTabId(path);

    // 이미 열려 있으면 다시 읽지 않는다. 파일 감시가 없어 다시 읽어도
    // 최신이라는 보장이 없고, 보던 글이 갑자기 바뀌는 쪽이 더 나쁘다.
    if (get().tabs.some((t) => t.id === id)) {
      set({ activeTab: id, selected: path });
      return;
    }

    const seq = ++tabSeq;
    set((s) => ({
      tabs: [...s.tabs, { kind: "note", id, path, title, body: null, error: null, seq }],
      activeTab: id,
      selected: path,
    }));

    let body: string | null = null;
    let error: string | null = null;
    try {
      const r = await window.piecepool.readRaw(path);
      if (r.ok) body = stripFrontmatter(r.value);
      else error = r.error.message;
    } catch (e) {
      // preload 가 없으면 여기로 온다. 탭은 열린 채 이유를 보여 준다.
      error = `앱 내부 연결이 끊겼다: ${String(e)}`;
    }

    // 세대까지 같아야 담는다. 그 사이에 닫혔거나 다시 열렸으면 이 응답은 낡은 것이다.
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.kind === "note" && t.id === id && t.seq === seq ? { ...t, body, error } : t,
      ),
    }));
  },

  openGraphTab: () =>
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === GRAPH_TAB_ID)
        ? s.tabs
        : [...s.tabs, { kind: "graph", id: GRAPH_TAB_ID, title: "그래프" }],
      activeTab: GRAPH_TAB_ID,
    })),

  openQueryTab: () =>
    set((s) => ({
      tabs: s.tabs.some((t) => t.id === QUERY_TAB_ID)
        ? s.tabs
        : [...s.tabs, { kind: "query", id: QUERY_TAB_ID, title: "쿼리" }],
      activeTab: QUERY_TAB_ID,
    })),

  focusTab: (id) =>
    set((s) => {
      const t = s.tabs.find((x) => x.id === id);
      if (t === undefined) return {};
      // 그래프 탭에는 경로가 없다 — 트리 선택을 건드리지 않는다.
      return t.kind === "note" ? { activeTab: id, selected: t.path } : { activeTab: id };
    }),

  closeTab: (id) =>
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return {};
      const tabs = s.tabs.filter((t) => t.id !== id);
      // 닫은 탭이 활성이었을 때만 옮긴다. 오른쪽 이웃, 없으면 왼쪽.
      const activeTab =
        s.activeTab === id ? (tabs[idx]?.id ?? tabs[idx - 1]?.id ?? null) : s.activeTab;
      return { tabs, activeTab };
    }),
}));
