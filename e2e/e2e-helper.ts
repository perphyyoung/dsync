import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

/** 复制当前环境变量，并剔除会让应用走 dev 模式的变量 */
export function e2eEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  delete env["ELECTRON_RENDERER_URL"];
  return { ...env, ...extra };
}

/** 建一次性工作目录，由调用方负责清理 */
export function makeWorkdir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
}

/**
 * 启动应用。args 必须是 "."：
 * 传 out/main/main.js 会让 app.getAppPath() 指向 out/main，preload 路径拼错。
 */
export async function launchApp(appData: string): Promise<LaunchedApp> {
  const app = await electron.launch({ args: ["."], env: e2eEnv({ DSYNC_DATA_DIR: appData }) });
  const page = await app.firstWindow();
  return { app, page };
}
