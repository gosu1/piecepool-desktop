// OWNER: 7단계 — 빈 셸이다. IPC·메뉴·창 상태 복원은 아직 없다.
import { app, BrowserWindow, Menu, shell } from "electron";
import { join } from "node:path";
import { registerHandlers } from "./ipc.ts";

// vite dev 서버를 본다. 프로덕션 빌드 경로(out/renderer)는 패키징을 시작할 때 정한다.
const DEV_URL = "http://localhost:5173";

/**
 * 부트와 윈도우 생성만 한다. 로직을 두지 않는다 —
 * 볼트 I/O·인덱스·인제스트·에이전트·LLM·git 은 전부 core/ 에 있다.
 */
export async function bootstrap(): Promise<void> {
  await app.whenReady();

  // Electron 기본 메뉴(File·Edit·View·Window·Help)를 쓰지 않는다.
  // DevTools 단축키도 저 기본 메뉴가 달아 주던 것이라 함께 사라진다.
  Menu.setApplicationMenu(null);

  // 창이 뜨기 전에 등록한다 — 렌더러가 곧바로 lastVault 를 부른다.
  registerHandlers();

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
      preload: join(import.meta.dirname, "../../out/preload/index.cjs"),
    },
  });

  win.loadURL(DEV_URL).catch((err: unknown) => {
    console.error(
      `vite dev 서버(${DEV_URL})에 연결하지 못했다 — 다른 터미널에서 npm run dev 를 먼저 켜라.`,
      err,
    );
  });

  // SPA 는 자기 origin 밖으로 내비게이트할 일이 없다.
  // 단, vite HMR 클라이언트가 같은 origin 으로 location.reload() 를 거는 것까지 막으면
  // full-reload 때마다 창이 멈춘다 — 다른 origin 으로 나가는 것만 막는다.
  win.webContents.on("will-navigate", (event, url) => {
    try {
      if (new URL(url).origin !== new URL(DEV_URL).origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });

  // 새 창을 띄우는 대신 OS 기본 브라우저로 넘긴다.
  // Electron 창으로 외부 URL 을 열면 그 창은 이 webPreferences 를 안 받는다.
  // url 은 렌더러(나중엔 사용자 마크다운)에서 오므로 http(s) 만 받는다 —
  // shell.openExternal 은 file:·smb:·ms-* 등 OS 가 등록한 아무 핸들러나 부른다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      // 검증한 값(href)을 넘긴다 — 원본 url 은 앞뒤 공백 같은 게 붙어 있을 수 있다.
      if (parsed.protocol === "http:" || parsed.protocol === "https:")
        void shell.openExternal(parsed.href);
    } catch {
      // 파싱 실패는 그냥 버린다.
    }
    return { action: "deny" };
  });

  // 기본 메뉴를 껐으므로 DevTools 단축키도 같이 사라졌다 — 손으로 다시 단다.
  // 지우지 말 것: UI 작업하는 사람들에게 창을 들여다볼 방법이 이것뿐이다.
  // before-input-event 는 keyDown·keyUp 둘 다에서 뜬다 — keyUp 까지 토글하면
  // 한 번 누른 게 두 번 토글되어(열림→즉시 닫힘) 단축키가 죽는다.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown" || input.isAutoRepeat) return;
    const isToggle =
      input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
    if (isToggle) {
      event.preventDefault();
      win.webContents.toggleDevTools();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// top-level await 를 쓰지 않는다 — ESM 엔트리는 모듈 평가가 끝나야 ready 가 뜨는데,
// bootstrap 이 whenReady 를 기다리므로 await 하면 서로를 기다리다 창 없이 멈춘다.
void bootstrap();
