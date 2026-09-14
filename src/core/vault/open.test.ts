import { describe, expect, it } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openVault } from "./open.ts";
import { PiecePoolError } from "../errors.ts";

async function tempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "pp-open-"));
}

describe("openVault", () => {
  it("폴더에서 Vault 를 만든다", async () => {
    const root = await tempDir();
    const v = await openVault(root);
    expect(v.root).toBe(resolve(root));
    expect(v.agentWriteRoot).toBe("wiki");
  });

  it("없는 폴더는 vault_not_found 로 던진다", async () => {
    const missing = join(await tempDir(), "없는폴더");
    await expect(openVault(missing)).rejects.toBeInstanceOf(PiecePoolError);
    await expect(openVault(missing)).rejects.toMatchObject({ kind: "vault_not_found" });
  });

  it("폴더에 아무 자국도 남기지 않는다", async () => {
    // 구경하려고 연 폴더에 .git·.piecepool 이 생기면 안 된다 (설계 §2.1).
    const root = await tempDir();
    await openVault(root);
    expect(await readdir(root)).toEqual([]);
  });
});
