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
 * 지금 열어 주는 것은 여덟이다.
 *
 * `readRaw` 만 renderer 에서 경로를 받는다 — 나머지 일곱은 인자가 없다.
 * 그 하나 때문에 main 이 resolveInVault 로 검증한다(core/vault/paths.ts).
 * 여기에 경로를 받는 함수를 더할 때마다 그 검증을 통과하는지 확인해야 한다.
 *
 * 창 조작 셋은 요청을 보낸 창에만 닿는다 — 어느 창을 조작할지는 main 이 정한다.
 */
export function exposeApi(): void {
  const api: PiecePoolApi = {
    pickVault: () => ipcRenderer.invoke(CHANNEL.vaultPick),
    lastVault: () => ipcRenderer.invoke(CHANNEL.vaultLast),
    readRaw: (path) => ipcRenderer.invoke(CHANNEL.noteRead, path),
    buildGraph: () => ipcRenderer.invoke(CHANNEL.graphBuild),
    minimizeWindow: () => ipcRenderer.send(CHANNEL.windowMinimize),
    toggleMaximizeWindow: () => ipcRenderer.send(CHANNEL.windowToggleMaximize),
    closeWindow: () => ipcRenderer.send(CHANNEL.windowClose),
    // 샌드박스 preload 에서도 process.platform 은 Electron 이 채워 준다.
    isMac: process.platform === "darwin",
  };
  contextBridge.exposeInMainWorld("piecepool", api);
}

exposeApi();
