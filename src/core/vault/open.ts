import type { Vault } from "../../shared/types.ts";

/**
 * 볼트를 연다. .git 이 없으면 init 하고, .piecepool/.gitignore 를 정비한다.
 * 이미 추적 중인 index.json 이 있으면 인덱스에서만 제거한다(파일은 남긴다).
 * 볼트 루트의 .gitignore 는 건드리지 않는다 — 사용자 소유 파일이다.
 */
export async function openVault(root: string): Promise<Vault> {
  throw new Error("unimplemented: core/vault/open.openVault");
}
