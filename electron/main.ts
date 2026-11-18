import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { COPY_CHUNK_SIZE, executeActions } from "../src/lib/execute";
import { ExecutionController } from "../src/lib/execute-controller";
import { ScanCancelledError, ScanController } from "../src/lib/controller";
import { runScan } from "../src/lib/pipeline";
import { migrateMoveCaches } from "../src/lib/index-migrate";
import { loadIndexPair } from "../src/lib/index-file";
import { listDeleted, restoreDeleted, softDelete } from "../src/lib/recycle";
import { readRecentPairs } from "../src/lib/recent";
import { openDirPairsDb, type DirPairsStore } from "../src/lib/dir-pairs-db";
import type { DirPairEntry } from "../src/lib/dir-pairs";
import { detectStale, refreshPaths } from "../src/lib/refresh";
import { rehashPair } from "../src/lib/rehash";
import type {
  ExecuteProgress,
  ExecuteRequest,
  FilterPrefs,
  RecentPair,
  RefreshRequest,
  RehashRequest,
  ScanRequest,
  SyncAction,
} from "../src/lib/types";
import { log, logPath } from "./logger";

const devUrl = process.env["ELECTRON_RENDERER_URL"];
const LOG_LEVELS = new Set(["error", "warn", "info", "debug"]);

let mainWindow: BrowserWindow | null = null;
let dirPairsDb: DirPairsStore | null = null;
let currentController: ScanController | null = null;
let execController: ExecutionController | null = null;

/** dev 写项目根 ds-data；e2e 通过 DSYNC_DATA_DIR 隔离；release 用 userData */
function dataRoot(): string {
  const override = process.env["DSYNC_DATA_DIR"];
  if (override) return override;
  return devUrl ? join(app.getAppPath(), "ds-data") : app.getPath("userData");
}

/* localStorage 等 Chromium 数据跟着应用数据目录走：e2e 与 dev 都不污染真实用户配置 */
if (process.env["DSYNC_DATA_DIR"] || devUrl) {
  app.setPath("userData", dataRoot());
}

function recentFilePath(): string {
  return join(dataRoot(), "recent-pairs.json");
}

function dirPairsDbPath(): string {
  return join(dataRoot(), "dir-pairs.db");
}

/** 打开应用级档案库；空库时从旧 recent-pairs.json 一次性导入并删除旧文件 */
async function loadDirPairs(): Promise<void> {
  dirPairsDb = openDirPairsDb(dirPairsDbPath());
  if (dirPairsDb.list().length > 0) return;
  const legacy = await readRecentPairs(recentFilePath());
  if (legacy.length === 0) return;
  dirPairsDb.importLegacy(legacy);
  await rm(recentFilePath(), { force: true }).catch(() => undefined);
}

/** 扫描成功才记录：只更新使用时间，已有条件保留 */
async function rememberPair(left: string, right: string): Promise<void> {
  try {
    dirPairsDb?.touch(left, right);
  } catch (error) {
    log.warn(`[pairs] 写入失败：${(error as Error).message}`);
  }
}

async function handleIpc<T>(channel: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    log.error(`[ipc ${channel}] ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

function parseScanRequest(value: unknown): ScanRequest {
  if (typeof value !== "object" || value === null) throw new Error("无效扫描参数");
  const input = value as Record<string, unknown>;
  const leftRoot = input["leftRoot"];
  const rightRoot = input["rightRoot"];
  if (typeof leftRoot !== "string" || typeof rightRoot !== "string") throw new Error("无效目录");

  const includeExts = input["includeExts"];
  const excludeExts = input["excludeExts"];
  const includeKeyword = input["includeKeyword"];
  const excludeKeyword = input["excludeKeyword"];

  return {
    leftRoot,
    rightRoot,
    minSize: typeof input["minSize"] === "number" ? input["minSize"] : 0,
    maxSize: typeof input["maxSize"] === "number" ? input["maxSize"] : 0,
    maxDepth: typeof input["maxDepth"] === "number" ? input["maxDepth"] : 0,
    includeKeyword: typeof includeKeyword === "string" ? includeKeyword : "",
    excludeKeyword: typeof excludeKeyword === "string" ? excludeKeyword : "",
    modifiedAfter: typeof input["modifiedAfter"] === "number" ? input["modifiedAfter"] : 0,
    modifiedBefore: typeof input["modifiedBefore"] === "number" ? input["modifiedBefore"] : 0,
    skipHidden: input["skipHidden"] !== false,
    includeExts: Array.isArray(includeExts)
      ? includeExts.filter((item): item is string => typeof item === "string")
      : [],
    excludeExts: Array.isArray(excludeExts)
      ? excludeExts.filter((item): item is string => typeof item === "string")
      : [],
    forceRehash: input["forceRehash"] === true,
  };
}

/** 白名单从 SyncAction["kind"] 推导：新增动作类型时这里会编译报错，不会静默漏掉 */
const ACTION_KINDS = new Set<SyncAction["kind"]>(["copy", "move", "soft-delete"]);

function parseExecuteRequest(value: unknown): ExecuteRequest {
  if (typeof value !== "object" || value === null) throw new Error("无效执行参数");
  const input = value as Record<string, unknown>;
  const leftRoot = input["leftRoot"];
  const rightRoot = input["rightRoot"];
  const actions = input["actions"];
  if (typeof leftRoot !== "string" || typeof rightRoot !== "string") throw new Error("无效目录");
  if (!Array.isArray(actions)) throw new Error("无效动作列表");

  const valid = actions.filter((item): item is SyncAction => {
    if (typeof item !== "object" || item === null) return false;
    const action = item as Record<string, unknown>;
    return (
      ACTION_KINDS.has(action["kind"] as SyncAction["kind"]) &&
      (action["side"] === "left" || action["side"] === "right") &&
      typeof action["toPath"] === "string"
    );
  });

  return { leftRoot, rightRoot, actions: valid };
}

ipcMain.handle("dir:pick", async (_event, raw?: unknown): Promise<string | null> => {
  const defaultPath = typeof raw === "string" && raw ? raw : undefined;
  const result = await dialog.showOpenDialog({
    title: "选择目录",
    ...(defaultPath ? { defaultPath } : {}),
    properties: ["openDirectory"],
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle("dir:open", async (_event, raw?: unknown): Promise<void> => {
  if (typeof raw !== "string" || !raw) throw new Error("无效目录");
  const error = await shell.openPath(raw);
  if (error) throw new Error(error);
});

ipcMain.handle("dirs:check", async (_event, raw: unknown): Promise<boolean[]> => {
  if (!Array.isArray(raw)) throw new Error("无效参数");
  const paths = raw.filter((item): item is string => typeof item === "string");
  return Promise.all(
    paths.map((path) =>
      stat(path)
        .then((info) => info.isDirectory())
        .catch(() => false),
    ),
  );
});

ipcMain.handle("recent:list", (): RecentPair[] =>
  (dirPairsDb?.recent() ?? []).map((item) => ({
    left: item.left,
    right: item.right,
    savedAt: item.usedAt ?? "",
  })),
);

ipcMain.handle("pairs:list", (): DirPairEntry[] => dirPairsDb?.list() ?? []);

ipcMain.handle("pairs:save", async (_event, raw: unknown): Promise<void> => {
  if (typeof raw !== "object" || raw === null) throw new Error("无效参数");
  const input = raw as Record<string, unknown>;
  const left = input["left"];
  const right = input["right"];
  const filters = input["filters"];
  if (typeof left !== "string" || typeof right !== "string") throw new Error("无效目录");
  if (typeof filters !== "object" || filters === null) throw new Error("无效过滤条件");
  dirPairsDb?.save(left, right, filters as FilterPrefs);
});

ipcMain.handle("pairs:remove", async (_event, raw: unknown): Promise<void> => {
  if (typeof raw !== "object" || raw === null) throw new Error("无效参数");
  const input = raw as Record<string, unknown>;
  const left = input["left"];
  const right = input["right"];
  if (typeof left !== "string" || typeof right !== "string") throw new Error("无效目录");
  dirPairsDb?.remove(left, right);
});

ipcMain.handle("sync:scan", async (event, raw: unknown) => {
  return handleIpc("sync:scan", async () => {
    const request = parseScanRequest(raw);
    const sender = event.sender;
    const controller = new ScanController();
    currentController = controller;
    try {
      const result = await runScan(request, {
        controller,
        onProgress: (progress) => {
          if (!sender.isDestroyed()) sender.send("sync:progress", progress);
        },
      });
      await rememberPair(request.leftRoot, request.rightRoot);
      log.info(
        `[scan] left=${request.leftRoot} right=${request.rightRoot} ` +
          `rows=${result.rows.length} warnings=${result.warnings.length}`,
      );
      return { cancelled: false, result };
    } catch (error) {
      if (error instanceof ScanCancelledError) {
        log.info(`[scan] 用户取消 left=${request.leftRoot} right=${request.rightRoot}`);
        return { cancelled: true };
      }
      throw error;
    } finally {
      currentController = null;
    }
  });
});

ipcMain.handle("sync:pause", (): void => {
  currentController?.pause();
});

ipcMain.handle("sync:resume", (): void => {
  currentController?.resume();
});

ipcMain.handle("sync:cancel", (): void => {
  currentController?.cancel();
});

function parseRehashRequest(value: unknown): RehashRequest {
  if (typeof value !== "object" || value === null) throw new Error("无效重算参数");
  const input = value as Record<string, unknown>;
  const leftRoot = input["leftRoot"];
  const rightRoot = input["rightRoot"];
  const left = input["left"];
  const right = input["right"];
  if (typeof leftRoot !== "string" || typeof rightRoot !== "string") throw new Error("无效目录");
  if (left !== null && typeof left !== "string") throw new Error("无效左侧路径");
  if (right !== null && typeof right !== "string") throw new Error("无效右侧路径");
  if (left === null && right === null) throw new Error("没有可重算的文件");
  return { leftRoot, rightRoot, left, right };
}

ipcMain.handle("sync:rehash", async (_event, raw: unknown) => {
  return handleIpc("sync:rehash", async () => {
    const request = parseRehashRequest(raw);
    const result = await rehashPair(request);
    log.info(`[rehash] left=${request.left ?? "-"} right=${request.right ?? "-"}`);
    return result;
  });
});

function parseRefreshRequest(value: unknown): RefreshRequest {
  if (typeof value !== "object" || value === null) throw new Error("无效刷新参数");
  const input = value as Record<string, unknown>;
  const leftRoot = input["leftRoot"];
  const rightRoot = input["rightRoot"];
  const targets = input["targets"];
  if (typeof leftRoot !== "string" || typeof rightRoot !== "string") throw new Error("无效目录");
  if (!Array.isArray(targets)) throw new Error("无效刷新目标");
  const parsed = targets.map((item) => {
    const entry = item as Record<string, unknown>;
    const rowIndex = entry["rowIndex"];
    const left = entry["left"];
    const right = entry["right"];
    if (typeof rowIndex !== "number") throw new Error("无效行号");
    if (left !== null && typeof left !== "string") throw new Error("无效左侧路径");
    if (right !== null && typeof right !== "string") throw new Error("无效右侧路径");
    return { rowIndex, left, right };
  });
  return { leftRoot, rightRoot, targets: parsed };
}

ipcMain.handle("sync:refresh", async (_event, raw: unknown) => {
  return handleIpc("sync:refresh", async () => {
    const request = parseRefreshRequest(raw);
    const result = await refreshPaths(request.leftRoot, request.rightRoot, request.targets);
    log.info(`[refresh] rows=${result.length}`);
    return result;
  });
});

function parseRootsPair(value: unknown): { leftRoot: string; rightRoot: string } {
  if (typeof value !== "object" || value === null) throw new Error("无效参数");
  const input = value as Record<string, unknown>;
  const leftRoot = input["leftRoot"];
  const rightRoot = input["rightRoot"];
  if (typeof leftRoot !== "string" || typeof rightRoot !== "string") throw new Error("无效目录");
  return { leftRoot, rightRoot };
}

ipcMain.handle("recycle:list", async (_event, raw: unknown) => {
  return handleIpc("recycle:list", async () => {
    const { leftRoot, rightRoot } = parseRootsPair(raw);
    const [left, right] = await Promise.all([
      listDeleted(leftRoot, "left"),
      listDeleted(rightRoot, "right"),
    ]);
    return [...left, ...right].toSorted((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  });
});

ipcMain.handle("recycle:restore", async (_event, raw: unknown) => {
  return handleIpc("recycle:restore", async () => {
    if (typeof raw !== "object" || raw === null) throw new Error("无效参数");
    const input = raw as Record<string, unknown>;
    const root = input["root"];
    const id = input["id"];
    if (typeof root !== "string" || typeof id !== "number") throw new Error("无效参数");
    const path = await restoreDeleted(root, id);
    log.info(`[recycle] 还原 ${path}`);
    return path;
  });
});

ipcMain.handle("sync:execute", async (event, raw: unknown) => {
  return handleIpc("sync:execute", async () => {
    const request = parseExecuteRequest(raw);

    // 扫描后被外部改过的文件不执行，避免覆盖用户刚改的内容
    const loaded = await loadIndexPair(request.leftRoot, request.rightRoot);
    const stale = await detectStale(request, loaded.data.pairs);
    const staleSet = new Set(stale.map((item) => item.path));
    const actions = request.actions.filter((action) => !staleSet.has(action.toPath));

    const controller = new ExecutionController();
    execController = controller;
    const sender = event.sender;
    let lastAt = 0;
    let lastBytes = 0;
    try {
      const result = await executeActions(
        { ...request, actions },
        { softDelete },
        {
          controller,
          onProgress: (progress: ExecuteProgress) => {
            /* 节流：100ms 或字节跳变 1MB 才推送，避免 IPC 风暴 */
            const now = Date.now();
            const bigJump = Math.abs(progress.fileBytesDone - lastBytes) >= COPY_CHUNK_SIZE;
            if (now - lastAt < 100 && !bigJump) return;
            lastAt = now;
            lastBytes = progress.fileBytesDone;
            if (!sender.isDestroyed()) sender.send("sync:execute-progress", progress);
          },
        },
      );
      result.stale = stale;
      await migrateMoveCaches(request.leftRoot, request.rightRoot, result.moves);
      log.info(
        `[execute] copied=${result.copied} moved=${result.moved} ` +
          `deleted=${result.deleted} failed=${result.failed.length} ` +
          `stale=${stale.length} cancelled=${result.cancelled}`,
      );
      return result;
    } finally {
      execController = null;
    }
  });
});

ipcMain.handle("sync:execute-pause", (): void => {
  execController?.pause();
});

ipcMain.handle("sync:execute-resume", (): void => {
  execController?.resume();
});

ipcMain.handle("sync:execute-cancel", (): void => {
  execController?.cancel();
});

ipcMain.handle("log:renderer", (_event, level: unknown, message: unknown): void => {
  if (typeof level !== "string" || !LOG_LEVELS.has(level)) throw new Error("无效日志级别");
  if (typeof message !== "string") throw new Error("无效日志内容");
  log[level as "error" | "warn" | "info" | "debug"](`[renderer] ${message}`);
});

function createWindow(): BrowserWindow {
  // dev 读项目根 resources；打包后 extraResources 把它复制到 resourcesPath 顶层
  const iconPath = devUrl
    ? join(app.getAppPath(), "resources/icon.png")
    : join(process.resourcesPath, "icon.png");

  const win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: "dsync",
    backgroundColor: "#0b0d12",
    icon: iconPath,
    webPreferences: {
      preload: join(app.getAppPath(), "out/preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  /* 启动即最大化；1360×880 作为还原尺寸，不记忆上次窗口状态 */
  win.maximize();
  win.once("ready-to-show", () => win.show());

  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(app.getAppPath(), "out/renderer/index.html"));
  }

  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    log.error(`[preload] ${preloadPath} ${error.message}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    log.error(`[renderer gone] reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

app.whenReady().then(async () => {
  await loadDirPairs();
  /* 不设应用菜单：目录对与目录选择都在扫描设置页里 */
  Menu.setApplicationMenu(null);
  log.info(
    `[start] electron=${process.versions.electron} node=${process.versions.node} ` +
      `pairs=${dirPairsDb?.list().length ?? 0} recent=${dirPairsDb?.recent().length ?? 0} log=${logPath}`,
  );
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
