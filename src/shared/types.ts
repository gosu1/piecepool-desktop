// core(Node) 와 renderer(브라우저) 가 함께 import 하는 유일한 파일이다.
// 타입과 순수 상수만 둔다 — fs 나 window 를 건드리는 코드가 한 줄이라도
// 들어가면 반대편 빌드가 깨진다.

/** 볼트 루트 기준 상대경로. POSIX 구분자로 고정한다. */
export type NotePath = string;

/** 열린 볼트. 경로 문자열 하나가 아니라 상태다. */
export interface Vault {
  root: string;
  /** 에이전트가 쓸 수 있는 루트. 기본값은 "wiki". 설정에서 바꿀 수 있다. */
  agentWriteRoot: string;
}

/**
 * 프론트매터 4필드. 전부 optional 이다 —
 * 임의의 옵시디언 볼트를 열면 프론트매터가 아예 없는 노트가 있고,
 * 그것도 똑같이 유효해야 한다.
 */
export interface Fm {
  title?: string;
  /** ISO date 문자열. YAML 이 Date 로 역직렬화하므로 파서가 정규화한다. */
  created?: string;
  updated?: string;
  /** append-only. 덮어쓰지 않는다 — core/vault/frontmatter.addSource 참조. */
  sources?: string[];
}

export interface Note {
  path: NotePath;
  title: string;
  frontmatter: Fm;
  body: string;
}

export interface LinkRef {
  from: NotePath;
  to: string;
  resolved: NotePath | null;
}

export interface GraphData {
  nodes: { id: NotePath; title: string }[];
  edges: { source: NotePath; target: NotePath }[];
}

/** 진행 상황. structured-clone 가능해야 한다 — Error 나 함수를 넣지 않는다. */
export interface Progress {
  step: string;
  detail?: string;
}

export type OnProgress = (p: Progress) => void;

export type ErrorKind =
  | "vault_not_found"
  | "path_escape"
  | "parse_failed"
  | "llm_failed"
  | "git_failed"
  /** core 가 만들지 않은 예외의 폴백. 없으면 renderer 가 문자열 매칭으로 되돌아간다. */
  | "unknown";

export interface AppError {
  kind: ErrorKind;
  message: string;
}

/**
 * IPC 경계 전용이다. core 는 throw 하고 main/ipc.ts 가 이걸로 감싼다.
 * Electron IPC 가 예외를 삼키기 때문이지, 예외를 안 쓰기 때문이 아니다.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };

export interface Author {
  name: string;
  email: string;
}

/** 에이전트 커밋의 고정 신원. 봉인 커밋은 볼트의 git config 를 따른다. */
export const AGENT_AUTHOR: Author = {
  name: "PiecePool Agent",
  email: "agent@piecepool.local",
};
