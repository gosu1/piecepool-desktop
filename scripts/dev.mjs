// vite dev 서버와 electron 을 한 명령으로 띄운다.
//
// 프로세스는 원래 둘이다 — renderer 를 서빙하는 vite 와 창을 띄우는 electron.
// 터미널까지 둘일 이유가 없어서 여기서 묶는다. 순서를 사람이 외우게 하면
// 틀렸을 때 창은 뜨는데 내용이 없고, 원인은 main 콘솔에만 남는다.
//
// 패키징 시점에 electron-vite 를 도입하면(ADR-0003) 이 파일은 지운다.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

// src/main/index.ts 의 DEV_URL 과 같은 포트다. 한쪽만 바꾸면 창이 빈 화면으로 뜬다.
const PORT = 5173;

// exports 맵을 타지 않도록 경로로 직접 집는다. npm 을 거치지 않으므로
// 죽일 때 손자 프로세스가 남지 않는다 — 5173 을 붙든 채 살아남는 그 문제다.
const VITE = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const ELECTRON = createRequire(import.meta.url)("electron");

const children = [];

function spawnTracked(command, args) {
  const child = spawn(command, args, { stdio: "inherit" });
  children.push(child);
  return child;
}

function killAll() {
  for (const child of children) child.kill();
}

/**
 * 이미 열려 있으면 true. 켜져 있는 dev 서버를 두 번 띄우지 않는다.
 *
 * host 는 반드시 "localhost" 다. vite 는 IPv6 루프백(`[::1]`)에만 바인딩하므로
 * `127.0.0.1` 로 붙으면 서버가 멀쩡히 떠 있어도 영원히 ECONNREFUSED 다.
 * 이름으로 물으면 node 가 두 패밀리를 다 시도하고, main/index.ts 의 DEV_URL 과도 같은 이름이 된다.
 */
function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "localhost" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite dev 서버가 ${timeoutMs}ms 안에 ${port} 을 열지 않았다`);
}

async function main() {
  // preload 를 먼저 빌드한다. 없으면 창은 정상으로 뜨고 window.piecepool 만
  // 조용히 undefined 가 된다 — 화면에 아무 표시가 없는 실패다.
  const build = spawn(process.execPath, [VITE, "build", "--config", "vite.preload.config.ts"], {
    stdio: "inherit",
  });
  const [buildCode] = await once(build, "exit");
  if (buildCode !== 0) process.exit(buildCode ?? 1);

  if (await isPortOpen(PORT)) {
    console.log(`[dev] ${PORT} 이 이미 열려 있다 — 그 서버를 쓴다.`);
  } else {
    spawnTracked(process.execPath, [VITE]);
    await waitForPort(PORT, 30_000);
  }

  const app = spawnTracked(ELECTRON, ["."]);
  const [appCode] = await once(app, "exit");

  // 창을 닫으면 dev 서버도 같이 내린다. 남겨 두면 다음 실행이 포트를 못 잡는다.
  killAll();
  process.exit(appCode ?? 0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    killAll();
    process.exit(1);
  });
}

main().catch((err) => {
  console.error(err);
  killAll();
  process.exit(1);
});
