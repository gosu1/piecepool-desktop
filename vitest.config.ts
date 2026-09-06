import { defineConfig } from "vitest/config";

// include 를 .test.ts 로 좁힌다 — 기본값은 .spec.ts 도 잡아서
// 나중에 들어올 Playwright e2e 를 vitest 가 집어삼킨다.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
