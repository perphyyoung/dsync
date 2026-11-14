import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    /* 单元测试只跑 src；e2e 由 Playwright 单独执行 */
    include: ["src/**/*.test.ts"],
    /* 同步核心大量真实文件读写，给足超时 */
    testTimeout: 20_000,
  },
});
