import { app } from "electron";
import ElectronLogger from "electron-log";
import { join } from "node:path";

/**
 * dev 与 e2e 写项目根 ds.log，便于直接查看；
 * release 写 userData，避免安装目录不可写。
 */
function logFilePath(): string {
  if (process.env["E2E"] === "1" || process.env["ELECTRON_RENDERER_URL"]) {
    return join(process.cwd(), "ds.log");
  }
  return join(app.getPath("userData"), "ds.log");
}

const isE2E = process.env["E2E"] === "1";

ElectronLogger.transports.file.resolvePathFn = logFilePath;
ElectronLogger.transports.file.level = isE2E ? "debug" : "info";
ElectronLogger.transports.console.level = isE2E ? false : "warn";

export const log = ElectronLogger;
export const logPath = logFilePath();
