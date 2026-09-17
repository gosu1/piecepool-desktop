import { defineConfig } from "vite";

// preload 만 담당한다.
// 창이 sandbox: true(Electron 기본값)로 뜨므로 preload 는 ESM 을 쓸 수 없고
// 단일 CommonJS 파일이어야 한다 — main 의 type stripping 도 renderer 번들도
// 그 형식을 만들어 주지 않는다(설계 §2.2).
export default defineConfig({
  build: {
    outDir: "out/preload",
    emptyOutDir: true,
    lib: {
      entry: "src/preload/index.ts",
      formats: ["cjs"],
      fileName: () => "index.cjs",
    },
    // electron 은 런타임이 제공한다. 번들에 넣으면 안 된다.
    rollupOptions: { external: ["electron"] },
  },
});
