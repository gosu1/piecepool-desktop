import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// renderer 만 담당한다. main 은 electron 이 .ts 를 직접 실행하므로 번들하지 않는다.
// 3타깃 빌드(electron-vite)는 패키징을 시작할 때 정한다.
export default defineConfig({
  root: "src/renderer",
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: { outDir: "../../out/renderer", emptyOutDir: true },
});
