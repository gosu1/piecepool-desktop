// OWNER: 7단계 — 빈 셸이다. IPC·메뉴·창 상태 복원은 아직 없다.
import { app, BrowserWindow, Menu } from "electron";
import { join } from "node:path";

/**
 * 부트와 윈도우 생성만 한다. 로직을 두지 않는다 —
 * 볼트 I/O·인덱스·인제스트·에이전트·LLM·git 은 전부 core/ 에 있다.
 */
export async function bootstrap(): Promise<void> {
  await app.whenReady();

  // Electron 기본 메뉴(File·Edit·View·Window·Help)를 쓰지 않는다.
  // DevTools 단축키도 저 기본 메뉴가 달아 주던 것이라 함께 사라진다.
  Menu.setApplicationMenu(null);

  createWindow();

  // macOS: 독 아이콘을 눌렀는데 창이 없으면 다시 연다.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // "preload 화이트리스트가 공격 표면 전체" 라는 전제가 이 둘에 걸려 있다.
      // 껍데기 단계부터 켜 둔다 — 나중에 켜면 그 사이에 만든 UI 가 깨진다.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// top-level await 를 쓰지 않는다 — ESM 엔트리는 모듈 평가가 끝나야 ready 가 뜨는데,
// bootstrap 이 whenReady 를 기다리므로 await 하면 서로를 기다리다 창 없이 멈춘다.
void bootstrap();
