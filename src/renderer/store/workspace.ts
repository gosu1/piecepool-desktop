import { create } from "zustand";
import type { NotePath, Result } from "../../shared/types.ts";
import type { TreeNode, VaultPayload } from "../../shared/ipc.ts";
import { compact } from "./panes.ts";
import type { Pane } from "./panes.ts";

// FileTree.tsx 가 스토어에서 TreeNode 를 가져다 쓴다. 그 import 를 살려 둔다.
export type { TreeNode };

// Shell·Pane 이 스토어에서 Pane 을 가져다 쓴다. 그 import 를 살려 둔다.
export type { Pane };

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

/** 정리 탭. 볼트마다 하나이고 진행 상태는 store/ingest.ts 가 쥔다. */
export const INGEST_TAB_ID = "ingest";

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

/** 정리 탭. 경로가 없고, 상태는 별도 스토어에 있다. */
export interface IngestTab {
  kind: "ingest";
  id: "ingest";
  title: "정리";
}

export type Tab = NoteTab | GraphTab | QueryTab | IngestTab;

/** 탭 요청 세대. 닫았다가 곧바로 다시 연 탭에 옛 응답이 덮어쓰는 것을 막는다. */
let tabSeq = 0;

/** 칸 id 세대. React 의 key 로 쓰므로 살아 있는 칸끼리 겹치지 않기만 하면 된다. */
let paneSeq = 0;

/** 탭이 든 칸의 인덱스. 없으면 -1. */
function paneOf(panes: Pane[], id: string): number {
  return panes.findIndex((p) => p.tabs.some((t) => t.id === id));
}

/** 칸에서 탭 하나를 뺀다. 뺀 것이 활성이었으면 오른쪽 이웃, 없으면 왼쪽으로 옮긴다. */
function removeTab(p: Pane, id: string): Pane {
  const idx = p.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return p;
  const tabs = p.tabs.filter((t) => t.id !== id);
  const activeTab = p.activeTab === id ? (tabs[idx]?.id ?? tabs[idx - 1]?.id ?? null) : p.activeTab;
  return { ...p, tabs, activeTab };
}

/**
 * 빈 칸 하나. 볼트를 바꿀 때와 초기 상태가 쓴다.
 *
 * id 가 늘 0 인 것이 맞다 — 키는 **같은 시점에 살아 있는 칸끼리만** 겹치지 않으면 되고,
 * 이 칸이 놓이는 순간 다른 칸은 전부 사라진다. paneSeq 를 쓰면 테스트가 앞선 분할 횟수에
 * 따라 다른 값을 기대하게 된다.
 */
function firstPane(): Pane {
  return { id: 0, tabs: [], activeTab: null };
}

/**
 * 그래프·쿼리처럼 id 가 상수인 탭을 연다.
 * 어느 칸에든 이미 있으면 그 칸으로 포커스하고, 없으면 activePane 에 붙인다.
 */
function openFixed(
  s: WorkspaceState,
  tab: GraphTab | QueryTab | IngestTab,
): Partial<WorkspaceState> {
  const found = paneOf(s.panes, tab.id);
  if (found !== -1) {
    return {
      panes: s.panes.map((p, i) => (i === found ? { ...p, activeTab: tab.id } : p)),
      activePane: found,
    };
  }
  return {
    panes: s.panes.map((p, i) =>
      i === s.activePane ? { ...p, tabs: [...p.tabs, tab], activeTab: tab.id } : p,
    ),
  };
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
  /** 열린 칸들. 길이는 1 또는 2 다. 절대 빈 배열이 되지 않는다. */
  panes: Pane[];
  /** 새 탭이 열릴 칸. */
  activePane: number;
  openTab: (path: NotePath, title: string) => Promise<void>;
  openGraphTab: () => void;
  openQueryTab: () => void;
  openIngestTab: () => void;
  /** 트리만 다시 읽는다. 정리가 wiki/ 에 페이지를 만든 뒤 부른다 — 탭과 칸은 그대로 둔다. */
  refreshTree: () => Promise<void>;
  focusTab: (id: string) => void;
  closeTab: (id: string) => void;
  moveTabToPane: (id: string, to: number) => void;
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
    // 칸도 하나로 되돌린다. NotePath 는 볼트 루트 기준 상대경로라 새 볼트에서 다른 파일을 뜻한다 —
    // 남겨 두면 이전 볼트의 글이 새 볼트의 탭 제목을 달고 조용히 그대로 떠 있는다.
    panes: [firstPane()],
    activePane: 0,
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
  panes: [firstPane()],
  activePane: 0,

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

    // 어느 칸에든 이미 열려 있으면 다시 읽지 않는다. 파일 감시가 없어 다시 읽어도
    // 최신이라는 보장이 없고, 보던 글이 갑자기 바뀌는 쪽이 더 나쁘다.
    const found = paneOf(get().panes, id);
    if (found !== -1) {
      set((s) => ({
        panes: s.panes.map((p, i) => (i === found ? { ...p, activeTab: id } : p)),
        activePane: found,
        selected: path,
      }));
      return;
    }

    const seq = ++tabSeq;
    // 먼저 타입을 붙여 둔다. map 안에서 리터럴로 쓰면 kind 가 string 으로 넓어진다.
    const tab: Tab = { kind: "note", id, path, title, body: null, error: null, seq };
    set((s) => ({
      panes: s.panes.map((p, i) =>
        i === s.activePane ? { ...p, tabs: [...p.tabs, tab], activeTab: id } : p,
      ),
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

    // 모든 칸을 훑는다 — 읽는 동안 탭이 옆 칸으로 옮겨졌을 수 있다.
    // 세대까지 같아야 담는다. 그 사이에 닫혔거나 다시 열렸으면 이 응답은 낡은 것이다.
    set((s) => ({
      panes: s.panes.map((p) => ({
        ...p,
        tabs: p.tabs.map((t) =>
          t.kind === "note" && t.id === id && t.seq === seq ? { ...t, body, error } : t,
        ),
      })),
    }));
  },

  openGraphTab: () =>
    set((s) => openFixed(s, { kind: "graph", id: GRAPH_TAB_ID, title: "그래프" })),

  openQueryTab: () => set((s) => openFixed(s, { kind: "query", id: QUERY_TAB_ID, title: "쿼리" })),

  openIngestTab: () =>
    set((s) => openFixed(s, { kind: "ingest", id: INGEST_TAB_ID, title: "정리" })),

  refreshTree: async () => {
    try {
      const r = await window.piecepool.readTree();
      if (r.ok) set({ tree: r.value });
    } catch {
      // 연결이 끊긴 것이다. 트리는 옛것으로 남지만 화면이 죽을 일은 아니다.
    }
  },

  focusTab: (id) =>
    set((s) => {
      const i = paneOf(s.panes, id);
      if (i === -1) return {};
      const t = s.panes[i].tabs.find((x) => x.id === id);
      const panes = s.panes.map((p, j) => (j === i ? { ...p, activeTab: id } : p));
      // 그래프·쿼리 탭에는 경로가 없다 — 트리 선택을 건드리지 않는다.
      return t?.kind === "note"
        ? { panes, activePane: i, selected: t.path }
        : { panes, activePane: i };
    }),

  closeTab: (id) =>
    set((s) => {
      const i = paneOf(s.panes, id);
      if (i === -1) return {};
      const panes = s.panes.map((p, j) => (j === i ? removeTab(p, id) : p));
      return compact(panes, s.activePane);
    }),

  moveTabToPane: (id, to) =>
    set((s) => {
      // 칸은 둘까지다.
      if (to < 0 || to > 1) return {};
      const from = paneOf(s.panes, id);
      if (from === -1) return {};
      const tab = s.panes[from].tabs.find((t) => t.id === id);
      if (tab === undefined) return {};

      // 칸이 하나면 to 는 **새 칸을 어느 쪽에 만드나**다(0=왼쪽, 1=오른쪽).
      // "0번 칸으로 옮겨라"와 겹치지 않는다 — 그때 from 도 언제나 0 이라 아무 일도 아니다.
      if (s.panes.length === 1) {
        const fresh: Pane = { id: ++paneSeq, tabs: [tab], activeTab: id };
        const rest = removeTab(s.panes[0], id);
        return compact(to === 0 ? [fresh, rest] : [rest, fresh], to);
      }

      // 칸이 둘이면 to 는 이미 있는 칸이다.
      if (from === to) return {};
      const panes = s.panes.map((p, i) => {
        if (i === from) return removeTab(p, id);
        if (i === to) return { ...p, tabs: [...p.tabs, tab], activeTab: id };
        return p;
      });

      // 떠난 칸이 비었으면 걷어낸다. 인덱스가 밀리므로 compact 가 새 activePane 을 준다.
      return compact(panes, to);
    }),
}));
