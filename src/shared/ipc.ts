// FROZEN: 파일 전체. 변경 시 상대 개발자와 합의 (IPC 경계 계약 — main·preload·renderer 3자)
// IPC 경계의 계약이다. main·preload·renderer 가 같은 문자열과 같은 모양을 쓰게 하는 유일한 출처다.
// shared 규칙 그대로 — 타입과 순수 상수만 둔다. node:* 도 electron 도 여기 없다.
import type { NotePath, Result } from "./types.ts";

/** 채널명. 문자열을 양쪽에 각각 적으면 오타가 런타임까지 간다. */
export const CHANNEL = {
  vaultPick: "vault:pick",
  vaultLast: "vault:last",
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

/**
 * preload 가 renderer 에 열어 주는 전부다.
 * 여기 없는 것은 화면에서 부를 수 없다 — 이 인터페이스가 곧 공격 표면의 목록이다.
 */
export interface PiecePoolApi {
  pickVault: () => Promise<Result<VaultPayload | null>>;
  lastVault: () => Promise<Result<VaultPayload | null>>;
}
