// FROZEN: 파일 전체. 변경 시 상대 개발자와 합의 (IPC 경계 계약 — main·preload·renderer 3자)
// IPC 경계의 계약이다. main·preload·renderer 가 같은 문자열과 같은 모양을 쓰게 하는 유일한 출처다.
// shared 규칙 그대로 — 타입과 순수 상수만 둔다. node:* 도 electron 도 여기 없다.
import type { GraphData, NotePath, Progress, Result } from "./types.ts";

/** 채널명. 문자열을 양쪽에 각각 적으면 오타가 런타임까지 간다. */
export const CHANNEL = {
  vaultPick: "vault:pick",
  vaultLast: "vault:last",
  vaultTree: "vault:tree",
  noteRead: "note:read",
  graphBuild: "graph:build",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggleMaximize",
  windowClose: "window:close",
  // 정리(4단계)와 안전망(3단계)을 화면에 잇는 일곱 (2026-09-17, ADR-0005 추가 절).
  ingestPending: "ingest:pending",
  ingestSync: "ingest:sync",
  ingestProgress: "ingest:progress",
  restorePlan: "restore:plan",
  restoreApply: "restore:apply",
  keyHas: "key:has",
  keySet: "key:set",
} as const;

/** 트리 한 칸. main 이 만들어 renderer 로 보낸다. */
export interface TreeNode {
  /** 파일명 그대로. `.md` 를 포함한다 — 떼는 것은 화면의 몫이다. */
  name: string;
  /** 볼트 루트 기준 상대경로. POSIX 구분자로 고정한다. */
  path: NotePath;
  kind: "dir" | "file";
  children?: TreeNode[];
}

/** 볼트를 열면 트리는 항상 필요하다. 두 번 왕복할 이유가 없어 함께 싣는다. */
export interface VaultPayload {
  /** 절대경로. */
  root: string;
  /** 폴더 이름. 사이드바 하단 전환기에 표시한다. */
  name: string;
  tree: TreeNode[];
}

/** 되돌리기 계획. 커밋이 건드린 경로마다 그 뒤 사용자가 손댔는지를 붙인다 (상위 §4.3). */
export interface RestorePath {
  path: NotePath;
  /** 그 커밋 뒤 사용자가 손댔다. 되돌리면 그 수정도 사라지므로 사용자가 골라야 한다. */
  changedSince: boolean;
}

export interface RestorePlan {
  commitOid: string;
  message: string;
  paths: RestorePath[];
}

/** 정리 한 번이 남긴 커밋 하나. 자료 하나 = 커밋 하나. */
export interface IngestCommit {
  oid: string;
  /** 자료 이름. 커밋 메시지의 `ingest(vault): ` 뒤와 같다. */
  label: string;
  paths: NotePath[];
}

export interface IngestSummary {
  commits: IngestCommit[];
  /** 검문 지적과 건너뜀 사유. 사람이 읽는 한 줄씩. */
  issues: string[];
  /** 형식 불량이 잦아 중간에 멈췄다. */
  halted: boolean;
}

/**
 * preload 가 renderer 에 열어 주는 전부다.
 * 여기 없는 것은 화면에서 부를 수 없다 — 이 인터페이스가 곧 공격 표면의 목록이다.
 */
export interface PiecePoolApi {
  pickVault: () => Promise<Result<VaultPayload | null>>;
  lastVault: () => Promise<Result<VaultPayload | null>>;
  /**
   * 노트 원문. **renderer 가 경로를 보내는 유일한 자리다** —
   * main 이 resolveInVault 로 검증한다. 이름이 core 의 readNote 와 다른 이유는
   * 돌려주는 것이 Note 가 아니라 문자열이기 때문이다.
   */
  readRaw: (path: NotePath) => Promise<Result<string>>;
  /**
   * 링크 색인에서 파생한 그래프. **인자가 없다** — 열린 볼트 전체가 대상이다.
   * 경로를 받지 않으므로 resolveInVault 가 지키는 표면이 늘지 않는다.
   */
  buildGraph: () => Promise<Result<GraphData>>;
  /** 열린 볼트의 트리만 다시 읽는다. 정리가 wiki/ 에 페이지를 만든 뒤 사이드바를 맞춘다. */
  readTree: () => Promise<Result<TreeNode[]>>;
  /** 아직 정리하지 않은 노트·원본 수. 정리 화면의 첫 문장이다. */
  pendingIngest: () => Promise<Result<number>>;
  /**
   * 볼트 전체 정리. 아직 안 한 노트·원본을 날짜순으로, 자료 하나가 커밋 하나다.
   * 오래 걸린다 — 진행은 onIngestProgress 로 온다. 한 번에 하나만 돈다.
   */
  syncVault: () => Promise<Result<IngestSummary>>;
  /** 정리 진행 구독. 돌려주는 함수로 해지한다. */
  onIngestProgress: (cb: (p: Progress) => void) => () => void;
  /** 되돌리기 계획. 경로는 main 이 커밋에서 뽑는다 — renderer 가 지어내지 않는다. */
  planRestore: (commitOid: string) => Promise<Result<RestorePlan>>;
  /**
   * 고른 경로만 되돌린다. **renderer 가 경로를 보내는 두 번째 자리다** —
   * core/git/restore 가 그 커밋이 건드린 경로인지 확인하고 아니면 거부한다.
   */
  restorePaths: (commitOid: string, paths: NotePath[]) => Promise<Result<string>>;
  /** LLM 키는 main 에만 있다. renderer 는 "설정됨" 만 안다. */
  hasKey: () => Promise<Result<boolean>>;
  setKey: (value: string) => Promise<Result<void>>;
  /** 창 조작. 돌려줄 값이 없어 단방향이다 — Result 로 감싸지 않는다. */
  minimizeWindow: () => void;
  toggleMaximizeWindow: () => void;
  closeWindow: () => void;
  /** macOS 는 창 조작 버튼을 OS 가 그린다. 우리 버튼을 그리면 둘 다 뜬다. */
  isMac: boolean;
}
