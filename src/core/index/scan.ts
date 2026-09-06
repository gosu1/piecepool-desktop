import type { GraphData, LinkRef, Vault } from "../../shared/types.ts";
import type { LinkTargets } from "./links.ts";

/** 파생 캐시다. 지우면 재빌드한다 — 복구 절차가 따로 없다. */
export interface VaultIndex {
  targets: LinkTargets;
  links: LinkRef[];
}

export async function scanVault(v: Vault): Promise<VaultIndex> {
  throw new Error("unimplemented: core/index/scan.scanVault");
}

export async function saveIndex(v: Vault, ix: VaultIndex): Promise<void> {
  throw new Error("unimplemented: core/index/scan.saveIndex");
}

export async function loadIndex(v: Vault): Promise<VaultIndex | null> {
  throw new Error("unimplemented: core/index/scan.loadIndex");
}

/** 그래프는 링크에서 파생된다. 저장하지 않는다. */
export function toGraph(ix: VaultIndex): GraphData {
  throw new Error("unimplemented: core/index/scan.toGraph");
}
