// OWNER: 7단계 — 채널명과 요청/응답 타입은 shared/ipc.ts 에 둔다.
import { app, dialog, ipcMain } from "electron";
import { basename, join } from "node:path";
import type { AppError, ErrorKind, Result } from "../shared/types.ts";
import type { VaultPayload } from "../shared/ipc.ts";
import { CHANNEL } from "../shared/ipc.ts";
import { PiecePoolError } from "../core/errors.ts";
import { openVault } from "../core/vault/open.ts";
import { readTree } from "../core/vault/tree.ts";
import { readLastVault, writeLastVault } from "./recent.ts";

/**
 * IPC 핸들러는 절대 throw 하지 않는다.
 *
 * Electron IPC 는 예외를 삼킨다 — main 에서 throw 하면 renderer 에는
 * 스택도 타입도 없는 밋밋한 문자열만 도착한다. Tauri 의 Result<T, String> 이
 * 강제하던 규율이 Electron 에는 없으므로 이 경계에서 직접 만든다.
 *
 * core 는 throw 하고 여기서 감싼다. kind 를 못 읽으면 "unknown" 으로 떨어뜨린다 —
 * JSON.parse 실패나 EACCES 처럼 core 가 만들지 않은 예외가 항상 있기 때문이다.
 */
export async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: toAppError(e) };
  }
}

export function toAppError(e: unknown): AppError {
  const kind: ErrorKind = e instanceof PiecePoolError ? e.kind : "unknown";
  return { kind, message: e instanceof Error ? e.message : String(e) };
}

/** 앱이 디스크에 남기는 유일한 상태. */
function stateFile(): string {
  return join(app.getPath("userData"), "state.json");
}

/** 볼트를 열고 트리까지 실어 보낸다. 열면 트리는 항상 필요하다. */
async function open(root: string): Promise<VaultPayload> {
  const v = await openVault(root);
  const payload = { root: v.root, name: basename(v.root), tree: await readTree(v) };
  await writeLastVault(stateFile(), v.root);
  return payload;
}

/** onProgress = webContents.send. CLI 가 console.log 를 넘기던 자리다. */
export function registerHandlers(): void {
  ipcMain.handle(CHANNEL.vaultPick, () =>
    wrap(async () => {
      const picked = await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (picked.canceled || picked.filePaths.length === 0) return null;
      return await open(picked.filePaths[0]);
    }),
  );

  ipcMain.handle(CHANNEL.vaultLast, () =>
    wrap(async () => {
      const last = await readLastVault(stateFile());
      if (last === null) return null;
      try {
        return await open(last);
      } catch (e) {
        // 사라진 폴더만 조용히 넘긴다. 권한·IO 실패는 화면에 보여야 한다(설계 §3).
        if (e instanceof PiecePoolError && e.kind === "vault_not_found") return null;
        throw e; // wrap() 이 Result 실패로 만든다
      }
    }),
  );
}
