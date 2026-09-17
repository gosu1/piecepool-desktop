import { create } from "zustand";
import type { NotePath, Progress } from "../../shared/types.ts";
import type { IngestCommit, RestorePlan } from "../../shared/ipc.ts";
import { useWorkspace } from "./workspace.ts";

/** 진행 줄은 이만큼만 쥔다. 500장 볼트를 돌리면 수천 줄이 되는데 화면이 볼 것은 끝부분이다. */
export const LOG_CAP = 400;

export function appendLog(log: Progress[], p: Progress): Progress[] {
  const next = log.length >= LOG_CAP ? log.slice(log.length - LOG_CAP + 1) : log.slice();
  next.push(p);
  return next;
}

/** 정리가 끝났을 때 화면에 한 줄. OS 알림과 같은 내용이다 — 알림을 못 봤어도 여기 남는다. */
export interface Toast {
  text: string;
}

export function summarize(commits: IngestCommit[], halted: boolean): string {
  if (commits.length === 0) return "새로 정리할 노트가 없었다.";
  const pages = new Set(commits.flatMap((c) => c.paths.filter((p) => p.startsWith("wiki/"))));
  return `노트 ${commits.length}장 → 위키 ${pages.size}장 갱신${halted ? " · 중간에 멈춤" : ""}`;
}

interface IngestState {
  running: boolean;
  /** 아직 정리하지 않은 노트 수. null 은 아직 안 물어본 것이다. */
  pending: number | null;
  /** 지금 처리 중인 것. "3/67 데미안" 처럼 온다. */
  current: string | null;
  log: Progress[];
  /** 이번 앱 세션에서 정리가 남긴 커밋. 되돌리기 후보다. 되돌린 것은 뺀다. */
  commits: IngestCommit[];
  issues: string[];
  error: string | null;
  toast: Toast | null;
  /** null 은 아직 안 물어본 것이다. */
  keyReady: boolean | null;
  plan: RestorePlan | null;
  chosen: Set<NotePath>;
  restoring: boolean;
  init: () => Promise<void>;
  refreshPending: () => Promise<void>;
  start: () => Promise<void>;
  saveKey: (value: string) => Promise<void>;
  dismissToast: () => void;
  openPlan: (oid: string) => Promise<void>;
  toggle: (path: NotePath) => void;
  closePlan: () => void;
  applyRestore: () => Promise<void>;
}

function message(e: unknown): string {
  return `앱 내부 연결이 끊겼다: ${String(e)}`;
}

export const useIngest = create<IngestState>((set, get) => ({
  running: false,
  pending: null,
  current: null,
  log: [],
  commits: [],
  issues: [],
  error: null,
  toast: null,
  keyReady: null,
  plan: null,
  chosen: new Set(),
  restoring: false,

  init: async () => {
    try {
      const r = await window.piecepool.hasKey();
      set({ keyReady: r.ok ? r.value : false });
    } catch (e) {
      set({ keyReady: false, error: message(e) });
    }
    await get().refreshPending();
  },

  refreshPending: async () => {
    try {
      const r = await window.piecepool.pendingIngest();
      set({ pending: r.ok ? r.value : null });
    } catch {
      set({ pending: null });
    }
  },

  start: async () => {
    if (get().running) return;
    set({ running: true, log: [], issues: [], error: null, toast: null, current: null });
    const off = window.piecepool.onIngestProgress((p) =>
      set((s) => ({
        log: appendLog(s.log, p),
        current: p.step === "진행" ? (p.detail ?? null) : s.current,
      })),
    );
    try {
      const r = await window.piecepool.syncVault();
      if (r.ok) {
        set((s) => ({
          commits: [...r.value.commits, ...s.commits],
          issues: r.value.issues,
          toast: { text: summarize(r.value.commits, r.value.halted) },
        }));
      } else {
        set({ error: r.error.message });
      }
    } catch (e) {
      set({ error: message(e) });
    } finally {
      off();
      set({ running: false, current: null });
      void useWorkspace.getState().refreshTree();
      void get().refreshPending();
    }
  },

  saveKey: async (value) => {
    try {
      const r = await window.piecepool.setKey(value);
      if (r.ok) set({ keyReady: value.trim() !== "", error: null });
      else set({ error: r.error.message });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  dismissToast: () => set({ toast: null }),

  openPlan: async (oid) => {
    try {
      const r = await window.piecepool.planRestore(oid);
      if (!r.ok) {
        set({ error: r.error.message });
        return;
      }
      // 그 뒤 손댄 파일은 기본으로 빼 둔다 — 되돌리면 그 수정이 사라진다 (상위 §4.3).
      const chosen = new Set(r.value.paths.filter((p) => !p.changedSince).map((p) => p.path));
      set({ plan: r.value, chosen, error: null });
    } catch (e) {
      set({ error: message(e) });
    }
  },

  toggle: (path) =>
    set((s) => {
      const next = new Set(s.chosen);
      if (!next.delete(path)) next.add(path);
      return { chosen: next };
    }),

  closePlan: () => set({ plan: null, chosen: new Set() }),

  applyRestore: async () => {
    const { plan, chosen } = get();
    if (plan === null || chosen.size === 0) return;
    set({ restoring: true });
    try {
      const r = await window.piecepool.restorePaths(plan.commitOid, [...chosen]);
      if (r.ok) {
        set((s) => ({
          plan: null,
          chosen: new Set(),
          commits: s.commits.filter((c) => c.oid !== plan.commitOid),
          error: null,
        }));
        void useWorkspace.getState().refreshTree();
        void get().refreshPending();
      } else {
        set({ error: r.error.message });
      }
    } catch (e) {
      set({ error: message(e) });
    } finally {
      set({ restoring: false });
    }
  },
}));
