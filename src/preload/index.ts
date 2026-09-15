// OWNER: 7단계 — contextBridge 화이트리스트.
import { contextBridge, ipcRenderer } from "electron";
import { CHANNEL } from "../shared/ipc.ts";
import type { PiecePoolApi } from "../shared/ipc.ts";

/**
 * 이 파일이 앱의 공격 표면 전체다.
 *
 * renderer 는 contextIsolation 으로 Node 접근이 차단돼 있고
 * 여기서 화이트리스트로 열어준 것만 쓸 수 있다.
 * fs 를 통째로 노출하면 격리가 무의미해진다 —
 * 경로 검증은 반드시 core/vault/paths.ts 에 둔다.
 *
 * 지금 열어 주는 것은 둘뿐이고, 둘 다 renderer 에서 경로를 받지 않는다.
 */
export function exposeApi(): void {
  const api: PiecePoolApi = {
    pickVault: () => ipcRenderer.invoke(CHANNEL.vaultPick),
    lastVault: () => ipcRenderer.invoke(CHANNEL.vaultLast),
  };
  contextBridge.exposeInMainWorld("piecepool", api);
}

exposeApi();
