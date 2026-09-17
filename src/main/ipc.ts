// OWNER: 7단계 — 채널명과 요청/응답 타입은 shared/ipc.ts 에 둔다.
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import type { IpcMainEvent } from "electron";
import { basename, join } from "node:path";
import type { AppError, ErrorKind, NotePath, Result, Vault } from "../shared/types.ts";
import type { IngestSummary, VaultPayload } from "../shared/ipc.ts";
import { CHANNEL } from "../shared/ipc.ts";
import { PiecePoolError } from "../core/errors.ts";
import { openVault } from "../core/vault/open.ts";
import { readTree } from "../core/vault/tree.ts";
import { readRaw } from "../core/vault/notes.ts";
import { scanVault, toGraph } from "../core/index/scan.ts";
import { readIdentity, writeIdentity } from "../core/git/repo.ts";
import { planRestore, restorePaths } from "../core/git/restore.ts";
import { syncVault } from "../core/ingest/sync.ts";
import { hasKey, readKey, setKey } from "./keys.ts";
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

/**
 * 지금 열려 있는 볼트. note:read 가 resolveInVault 에 넘길 v 다.
 * renderer 가 보낸 경로를 이것 없이 검증할 방법이 없다 — 재구축 설계 §3 이 지시한 자리다.
 */
let opened: Vault | null = null;

function requireVault(): Vault {
  if (opened === null) throw new PiecePoolError("vault_not_found", "볼트가 열려 있지 않다");
  return opened;
}

/** renderer 가 보낸 값이다. 타입은 경계를 못 건너오므로 여기서 직접 본다. */
function str(x: unknown, what: string): string {
  if (typeof x !== "string") throw new PiecePoolError("path_escape", `${what}가 문자열이 아니다`);
  return x;
}

/** 정리는 한 번에 하나만 돈다 (v1 은 순차, ADR-0002 결정 7). */
let syncing = false;

/** 앱이 디스크에 남기는 유일한 상태. */
function stateFile(): string {
  return join(app.getPath("userData"), "state.json");
}

/** 볼트를 열고 트리까지 실어 보낸다. 열면 트리는 항상 필요하다. */
async function open(root: string): Promise<VaultPayload> {
  const v = await openVault(root);
  const payload = { root: v.root, name: basename(v.root), tree: await readTree(v) };
  await writeLastVault(stateFile(), v.root);
  opened = v;
  return payload;
}

/**
 * 요청을 보낸 창을 이벤트에서 찾는다.
 * 모듈 변수로 쥐면 창이 여럿이 될 때 엉뚱한 창을 닫는다 — 조용히 틀리는 자리다.
 */
function senderWindow(e: IpcMainEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(e.sender);
}

/** vault 둘, 그래프 하나, 창 조작 셋을 등록한다. 창 조작은 돌려줄 값이 없어 단방향이다. */
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

  ipcMain.handle(CHANNEL.noteRead, (_e, path: unknown) =>
    wrap(async () => {
      // renderer 가 보낸 값이다. 타입은 경계를 못 건너오므로 여기서 직접 본다.
      if (typeof path !== "string") {
        throw new PiecePoolError("path_escape", "경로가 문자열이 아니다");
      }
      if (opened === null) {
        throw new PiecePoolError("vault_not_found", "볼트가 열려 있지 않다");
      }
      return await readRaw(opened, path);
    }),
  );

  ipcMain.handle(CHANNEL.graphBuild, () =>
    wrap(async () => {
      // 인자가 없다 — 검증할 경로가 없고, 대상은 지금 열린 볼트 전체다.
      if (opened === null) {
        throw new PiecePoolError("vault_not_found", "볼트가 열려 있지 않다");
      }
      return toGraph(await scanVault(opened));
    }),
  );

  ipcMain.handle(CHANNEL.vaultTree, () => wrap(async () => await readTree(requireVault())));

  // 정리 — 오래 걸리므로 진행은 요청한 창으로 이벤트로 흘린다. 결과는 커밋 목록이다.
  ipcMain.handle(CHANNEL.ingestSync, (e) =>
    wrap(async (): Promise<IngestSummary> => {
      const v = requireVault();
      if (syncing) throw new PiecePoolError("unknown", "정리가 이미 돌고 있다");
      syncing = true;
      try {
        // core 는 환경 변수를 읽는다. 앱에서는 safeStorage 의 키를 여기서 올린다.
        if (!process.env.PIECEPOOL_LLM_API_KEY) {
          const key = await readKey();
          if (key !== null) process.env.PIECEPOOL_LLM_API_KEY = key;
        }
        const r = await syncVault(v, {
          onProgress: (p) => {
            if (!e.sender.isDestroyed()) e.sender.send(CHANNEL.ingestProgress, p);
          },
        });
        return {
          commits: r.commits.map((c) => ({ oid: c.commitOid, label: c.label, paths: c.written })),
          issues: r.issues,
          halted: r.halted,
        };
      } finally {
        syncing = false;
      }
    }),
  );

  ipcMain.handle(CHANNEL.restorePlan, (_e, oid: unknown) =>
    wrap(async () => await planRestore(requireVault(), str(oid, "커밋"))),
  );

  ipcMain.handle(CHANNEL.restoreApply, (_e, oid: unknown, paths: unknown) =>
    wrap(async () => {
      if (!Array.isArray(paths)) throw new PiecePoolError("path_escape", "경로 목록이 아니다");
      const list: NotePath[] = paths.map((p) => str(p, "경로"));
      // 그 커밋이 건드린 경로인지는 restorePaths 가 확인한다 — 아니면 거부한다.
      return await restorePaths(requireVault(), str(oid, "커밋"), list);
    }),
  );

  ipcMain.handle(CHANNEL.gitIdentity, () => wrap(async () => await readIdentity(requireVault())));

  ipcMain.handle(CHANNEL.gitSetIdentity, (_e, author: unknown) =>
    wrap(async () => {
      const a = author as { name?: unknown; email?: unknown } | null;
      const name = str(a?.name, "이름").trim();
      const email = str(a?.email, "이메일").trim();
      if (name === "") throw new PiecePoolError("git_failed", "이름이 비어 있다");
      await writeIdentity(requireVault(), { name, email });
    }),
  );

  ipcMain.handle(CHANNEL.keyHas, () => wrap(hasKey));
  ipcMain.handle(CHANNEL.keySet, (_e, value: unknown) =>
    wrap(async () => await setKey(str(value, "키"))),
  );

  // invoke 가 아니라 on 이다 — 돌려줄 값이 없다는 것을 API 선택으로 드러낸다.
  ipcMain.on(CHANNEL.windowMinimize, (e) => senderWindow(e)?.minimize());

  ipcMain.on(CHANNEL.windowToggleMaximize, (e) => {
    const win = senderWindow(e);
    if (win === null) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });

  ipcMain.on(CHANNEL.windowClose, (e) => senderWindow(e)?.close());
}
