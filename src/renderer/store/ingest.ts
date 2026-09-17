import { create } from "zustand";
import type { Author, NotePath, Progress } from "../../shared/types.ts";
import type { IngestCommit, RestorePlan } from "../../shared/ipc.ts";
import { useWorkspace } from "./workspace.ts";

/** 진행 줄은 이만큼만 쥔다. 500장 볼트를 돌리면 수천 줄이 되는데 화면이 볼 것은 끝부분이다. */
export const LOG_CAP = 400;

export function appendLog(log: Progress[], p: Progress): Progress[] {
  const next = log.length >= LOG_CAP ? log.slice(log.length - LOG_CAP + 1) : log.slice();
  next.push(p);
  return next;
}

interface IngestState {
  running: boolean;
  log: Progress[];
  /** 이번 앱 세션에서 정리가 남긴 커밋. 되돌리기 후보다. 되돌린 것은 뺀다. */
  commits: IngestCommit[];
  issues: string[];
  error: string | null;
  /** null 은 아직 안 물어본 것이다. */
  keyReady: boolean | null;
  /** 정리가 "신원 없음" 으로 멈췄다 — 이름을 받아야 한다. */
  identityNeeded: boolean;
  plan: RestorePlan | null;
  chosen: Set<NotePath>;
  restoring: boolean;
  init: () => Promise<void>;
  start: () => Promise<void>;
  saveKey: (value: string) => Promise<void>;
  saveIdentity: (a: Author) => Promise<void>;
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
  log: [],
  commits: [],
  issues: [],
  error: null,
  keyReady: null,
  identityNeeded: false,
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
  },

  start: async () => {
    if (get().running) return;
    set({ running: true, log: [], issues: [], error: null, identityNeeded: false });
    const off = window.piecepool.onIngestProgress((p) =>
      set((s) => ({ log: appendLog(s.log, p) })),
    );
    try {
      const r = await window.piecepool.syncVault();
      if (r.ok) {
        set((s) => ({ commits: [...r.value.commits, ...s.commits], issues: r.value.issues }));
        if (r.value.halted)
          set({ error: "형식 불량이 잦아 멈췄다. 다시 시작하면 그 다음 장부터 이어간다." });
      } else {
        // 신원이 없어 봉인을 못 한 경우만 따로 안내한다 — 나머지는 메시지 그대로.
        const identity = r.error.kind === "git_failed" && r.error.message.includes("신원");
        set({ error: identity ? null : r.error.message, identityNeeded: identity });
      }
    } catch (e) {
      set({ error: message(e) });
    } finally {
      off();
      set({ running: false });
      void useWorkspace.getState().refreshTree();
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

  saveIdentity: async (a) => {
    try {
      const r = await window.piecepool.setGitIdentity(a);
      if (r.ok) set({ identityNeeded: false, error: null });
      else set({ error: r.error.message });
    } catch (e) {
      set({ error: message(e) });
    }
  },

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
