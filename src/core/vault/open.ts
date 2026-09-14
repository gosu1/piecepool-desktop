import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Vault } from "../../shared/types.ts";
import { PiecePoolError } from "../errors.ts";

/**
 * 볼트를 연다. 폴더가 있는지 확인하고 Vault 를 만든다.
 *
 * git init 과 .piecepool 정비는 **하지 않는다** — 구경하려고 연 폴더에 자국을
 * 남기지 않는다(2026-09-14 실제 볼트 설계 §2.1). 안전망이 실제로 필요해지는
 * 시점, 즉 에이전트가 처음 쓸 때 3단계에서 붙인다.
 */
export async function openVault(root: string): Promise<Vault> {
  const abs = resolve(root);

  let info;
  try {
    info = await stat(abs);
  } catch {
    throw new PiecePoolError("vault_not_found", `폴더를 찾지 못했다: ${abs}`);
  }
  if (!info.isDirectory()) {
    throw new PiecePoolError("vault_not_found", `폴더가 아니다: ${abs}`);
  }

  return { root: abs, agentWriteRoot: "wiki" };
}
