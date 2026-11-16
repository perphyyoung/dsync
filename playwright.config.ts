import process from "node:process";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  /* 单条用例上限 10s，断言与其他显式等待统一 5s；见 AGENTS.md 的 e2e 约定 */
  timeout: 10_000,
  expect: { timeout: 5_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  fullyParallel: false,
  reporter: "list",
  use: { trace: "on-first-retry" },
});
