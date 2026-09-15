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
 * 지금 열어 주는 것은 여섯이고, 하나도 renderer 에서 경로를 받지 않는다.
 * 창 조작 셋은 요청을 보낸 창에만 닿는다 — 어느 창을 조작할지는 main 이 정한다.
 */
export function exposeApi(): void {
  const api: PiecePoolApi = {
    pickVault: () => ipcRenderer.invoke(CHANNEL.vaultPick),
    lastVault: () => ipcRenderer.invoke(CHANNEL.vaultLast),
    minimizeWindow: () => ipcRenderer.send(CHANNEL.windowMinimize),
    toggleMaximizeWindow: () => ipcRenderer.send(CHANNEL.windowToggleMaximize),
    closeWindow: () => ipcRenderer.send(CHANNEL.windowClose),
    // 샌드박스 preload 에서도 process.platform 은 Electron 이 채워 준다.
    isMac: process.platform === "darwin",
  };
  contextBridge.exposeInMainWorld("piecepool", api);
}

exposeApi();
