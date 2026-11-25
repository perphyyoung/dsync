import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import { availableParallelism } from "node:os";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import hashWorkerPath from "./hash-worker?modulePath";
import { executeActions } from "../src/lib/execute";
import { ExecutionController } from "../src/lib/execute-controller";
import { ScanCancelledError, ScanController } from "../src/lib/controller";
import { HashWorkerPool } from "../src/lib/hash-pool";
import { detectDiskType } from "../src/lib/disk-type";
import { runScan } from "../src/lib/pipeline";
import { migrateMoveCaches } from "../src/lib/index-migrate";
import { loadIndexPair, patchIndex } from "../src/lib/index-file";
import { copyCachePairs } from "../src/lib/copy-cache";
import { listDeleted, restoreDeleted, softDelete } from "../src/lib/recycle";
import { readRecentPairs } from "../src/lib/recent";
import { openMainDb, type MainStore } from "../src/lib/main-db";
import type { DirPairEntry } from "../src/lib/dir-pairs";
import { detectStale, refreshPaths } from "../src/lib/refresh";
import { rehashPair } from "../src/lib/rehash";
import type {
  AppSettings,
  CopyRecord,
  DiskMode,
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
let mainDb: MainStore | null = null;
let currentController: ScanController | null = null;
let execController: ExecutionController | null = null;
let hashPool: HashWorkerPool | null = null;

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

function mainDbPath(): string {
  return join(dataRoot(), "dsync-main.db");
}

/** 旧 dir-pairs.db 不迁移、不删除：新库从空开始，目录对档案丢一次可接受 */
function scanThreadsLimit(): number {
  return Math.max(1, availableParallelism());
}

function defaultScanThreads(): number {
  return Math.max(1, Math.floor(availableParallelism() / 2));
}

function clampScanThreads(value: number): number {
  return Math.min(scanThreadsLimit(), Math.max(1, Math.floor(value)));
}

function readScanThreads(): number {
  const raw = mainDb?.getSetting("scanThreads") ?? null;
  const parsed = raw === null ? null : Number.parseInt(raw, 10);
  return parsed !== null && Number.isFinite(parsed)
    ? clampScanThreads(parsed)
    : defaultScanThreads();
}

function defaultSsdCopyThreads(): number {
  return Math.min(scanThreadsLimit(), Math.max(2, Math.floor(availableParallelism() / 2)));
}

function clampSsdCopyThreads(value: number): number {
  return Math.min(scanThreadsLimit(), Math.max(1, Math.floor(value)));
}

function readSsdCopyThreads(): number {
  const raw = mainDb?.getSetting("ssdCopyThreads") ?? null;
  const parsed = raw === null ? null : Number.parseInt(raw, 10);
  return parsed !== null && Number.isFinite(parsed)
    ? clampSsdCopyThreads(parsed)
    : defaultSsdCopyThreads();
}

function readDiskMode(): DiskMode {
  const raw = mainDb?.getSetting("diskMode");
  return raw === "ssd" || raw === "hdd" ? raw : "auto";
}

/** 未写入过记录时为 true，保持原有「完成即关窗」行为 */
function readAutoCloseExecWindow(): boolean {
  return (mainDb?.getSetting("autoCloseExecWindow") ?? "1") !== "0";
}

function defaultSsdParallelFiles(): number {
  return Math.min(scanThreadsLimit(), Math.max(2, Math.floor(availableParallelism() / 2)));
}

function clampSsdParallelFiles(value: number): number {
  return Math.min(scanThreadsLimit(), Math.max(1, Math.floor(value)));
}

function readSsdParallelFiles(): number {
  const raw = mainDb?.getSetting("ssdParallelFiles") ?? null;
  const parsed = raw === null ? null : Number.parseInt(raw, 10);
  return parsed !== null && Number.isFinite(parsed)
    ? clampSsdParallelFiles(parsed)
    : defaultSsdParallelFiles();
}

function appSettings(): AppSettings {
  const rawScan = mainDb?.getSetting("scanThreads") ?? null;
  const parsedScan = rawScan === null ? null : Number.parseInt(rawScan, 10);
  const scanExplicit = parsedScan !== null && Number.isFinite(parsedScan);
  const rawCopy = mainDb?.getSetting("ssdCopyThreads") ?? null;
  const parsedCopy = rawCopy === null ? null : Number.parseInt(rawCopy, 10);
  const copyExplicit = parsedCopy !== null && Number.isFinite(parsedCopy);
  const rawFiles = mainDb?.getSetting("ssdParallelFiles") ?? null;
  const parsedFiles = rawFiles === null ? null : Number.parseInt(rawFiles, 10);
  const filesExplicit = parsedFiles !== null && Number.isFinite(parsedFiles);
  return {
    scanThreads: readScanThreads(),
    scanThreadsAuto: !scanExplicit,
    ssdCopyThreads: readSsdCopyThreads(),
    ssdCopyThreadsAuto: !copyExplicit,
    ssdParallelFiles: readSsdParallelFiles(),
    ssdParallelFilesAuto: !filesExplicit,
    diskMode: readDiskMode(),
    autoCloseExecWindow: readAutoCloseExecWindow(),
    logicalProcessors: scanThreadsLimit(),
  };
}

function getHashPool(): HashWorkerPool {
  if (!hashPool) {
    hashPool = new HashWorkerPool(() => new Worker(hashWorkerPath));
  }
  return hashPool;
}

/** 打开应用级主库 dsync-main.db；旧 dir-pairs.db 不迁移、不读取 */
async function loadMainDb(): Promise<void> {
  mainDb = openMainDb(mainDbPath());
  /* 设置项已重命名为 SSD 前缀，旧键直接丢弃 */
  mainDb.deleteSetting("copyThreads");
  mainDb.deleteSetting("parallelFiles");
  if (mainDb.list().length > 0) return;
  const legacy = await readRecentPairs(recentFilePath());
  if (legacy.length === 0) return;
  mainDb.importLegacy(legacy);
  await rm(recentFilePath(), { force: true }).catch(() => undefined);
}

/** 扫描成功才记录：只更新使用时间，已有条件保留 */
async function rememberPair(left: string, right: string): Promise<void> {
  try {
    mainDb?.touch(left, right);
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

  const rawRate = input["rateLimitBytesPerSec"];
  const rateLimitBytesPerSec =
    typeof rawRate === "number" && Number.isFinite(rawRate) && rawRate > 0
      ? Math.round(rawRate)
      : undefined;

  return {
    leftRoot,
    rightRoot,
    actions: valid,
    ...(rateLimitBytesPerSec ? { rateLimitBytesPerSec } : {}),
  };
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
  (mainDb?.recent() ?? []).map((item) => ({
    left: item.left,
    right: item.right,
    savedAt: item.usedAt ?? "",
  })),
);

ipcMain.handle("pairs:list", (): DirPairEntry[] => mainDb?.list() ?? []);

ipcMain.handle("pairs:save", async (_event, raw: unknown): Promise<void> => {
  if (typeof raw !== "object" || raw === null) throw new Error("无效参数");
  const input = raw as Record<string, unknown>;
  const left = input["left"];
  const right = input["right"];
  const filters = input["filters"];
  if (typeof left !== "string" || typeof right !== "string") throw new Error("无效目录");
  if (typeof filters !== "object" || filters === null) throw new Error("无效过滤条件");
  mainDb?.save(left, right, filters as FilterPrefs);
});

ipcMain.handle("pairs:remove", async (_event, raw: unknown): Promise<void> => {
  if (typeof raw !== "object" || raw === null) throw new Error("无效参数");
  const input = raw as Record<string, unknown>;
  const left = input["left"];
  const right = input["right"];
  if (typeof left !== "string" || typeof right !== "string") throw new Error("无效目录");
  mainDb?.remove(left, right);
});

ipcMain.handle("settings:get", (): AppSettings => appSettings());

ipcMain.handle("settings:set-scan-threads", (_event, raw: unknown): AppSettings => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error("无效线程数");
  mainDb?.setSetting("scanThreads", String(clampScanThreads(raw)));
  return appSettings();
});

ipcMain.handle("settings:reset-scan-threads", (): AppSettings => {
  mainDb?.deleteSetting("scanThreads");
  return appSettings();
});

ipcMain.handle("settings:set-ssd-copy-threads", (_event, raw: unknown): AppSettings => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error("无效线程数");
  mainDb?.setSetting("ssdCopyThreads", String(clampSsdCopyThreads(raw)));
  return appSettings();
});

ipcMain.handle("settings:reset-ssd-copy-threads", (): AppSettings => {
  mainDb?.deleteSetting("ssdCopyThreads");
  return appSettings();
});

ipcMain.handle("settings:set-disk-mode", (_event, raw: unknown): AppSettings => {
  if (raw !== "auto" && raw !== "ssd" && raw !== "hdd") {
    throw new Error("无效磁盘类型");
  }
  mainDb?.setSetting("diskMode", raw);
  return appSettings();
});

ipcMain.handle("settings:set-ssd-parallel-files", (_event, raw: unknown): AppSettings => {
  if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error("无效并行文件数");
  mainDb?.setSetting("ssdParallelFiles", String(clampSsdParallelFiles(raw)));
  return appSettings();
});

ipcMain.handle("settings:reset-ssd-parallel-files", (): AppSettings => {
  mainDb?.deleteSetting("ssdParallelFiles");
  return appSettings();
});

ipcMain.handle("settings:set-auto-close-exec", (_event, raw: unknown): AppSettings => {
  if (typeof raw !== "boolean") throw new Error("无效设置");
  mainDb?.setSetting("autoCloseExecWindow", raw ? "1" : "0");
  return appSettings();
});

ipcMain.handle("sync:scan", async (event, raw: unknown) => {
  return handleIpc("sync:scan", async () => {
    const request = parseScanRequest(raw);
    const sender = event.sender;
    const controller = new ScanController();
    const threads = readScanThreads();
    const pool = getHashPool();
    pool.setConcurrency(threads);
    currentController = controller;
    try {
      const result = await runScan(request, {
        controller,
        hashConcurrency: threads,
        hashFn: (path, options) => pool.hashFile(path, options),
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

/** 成功复制的哈希已知，定点写回两侧索引；写失败只影响下次缓存命中，不影响复制结果 */
async function cacheCopyIndexes(
  leftRoot: string,
  rightRoot: string,
  copies: CopyRecord[],
): Promise<void> {
  if (copies.length === 0) return;
  const upserts = copyCachePairs(copies);
  const outcomes = await Promise.allSettled([
    patchIndex(leftRoot, { upserts }),
    patchIndex(rightRoot, { upserts }),
  ]);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      log.warn(`[execute] 复制缓存写入失败：${String(outcome.reason)}`);
    }
  }
}

ipcMain.handle("sync:execute", async (event, raw: unknown) => {
  return handleIpc("sync:execute", async () => {
    const request = parseExecuteRequest(raw);

    // 扫描后被外部改过的文件不执行，避免覆盖用户刚改的内容
    const loaded = await loadIndexPair(request.leftRoot, request.rightRoot);
    const stale = await detectStale(request, loaded.data.pairs);
    const staleSet = new Set(stale.map((item) => item.path));
    const actions = request.actions.filter((action) => !staleSet.has(action.toPath));

    const controller = new ExecutionController();
    controller.setRateLimit(request.rateLimitBytesPerSec ?? 0);
    execController = controller;
    const pool = getHashPool();
    pool.setConcurrency(readScanThreads());
    const ssdCopyThreads = readSsdCopyThreads();
    const ssdParallelFiles = readSsdParallelFiles();
    const diskMode = readDiskMode();
    const sender = event.sender;
    let lastAt = 0;
    let pendingProgress: ExecuteProgress | null = null;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    const sendProgress = (progress: ExecuteProgress): void => {
      if (!sender.isDestroyed()) sender.send("sync:execute-progress", progress);
    };
    const flushProgress = (): void => {
      if (progressTimer) {
        clearTimeout(progressTimer);
        progressTimer = null;
      }
      if (!pendingProgress) return;
      const progress = pendingProgress;
      pendingProgress = null;
      lastAt = Date.now();
      sendProgress(progress);
    };
    const scheduleProgress = (progress: ExecuteProgress): void => {
      pendingProgress = progress;
      const now = Date.now();
      if (now - lastAt >= 500) {
        flushProgress();
        return;
      }
      if (progressTimer) return;
      progressTimer = setTimeout(
        () => {
          progressTimer = null;
          flushProgress();
        },
        500 - (now - lastAt),
      );
    };
    try {
      const result = await executeActions(
        { ...request, actions },
        {
          softDelete,
          hash: (path) => pool.hashFile(path),
          ssdCopyThreads,
          ssdParallelFiles,
          diskKind: (root) => detectDiskType(root, diskMode),
        },
        {
          controller,
          onProgress: (progress: ExecuteProgress) => {
            /* 500ms 节流；最后一次进度不丢，校验开始时能看到 full bytes */
            scheduleProgress(progress);
          },
        },
      );
      flushProgress();
      result.stale = stale;
      await migrateMoveCaches(request.leftRoot, request.rightRoot, result.moves);
      await cacheCopyIndexes(request.leftRoot, request.rightRoot, result.copies);
      log.info(
        `[execute] copied=${result.copied} moved=${result.moved} ` +
          `deleted=${result.deleted} failed=${result.failed.length} ` +
          `stale=${stale.length} cancelled=${result.cancelled}`,
      );
      return result;
    } finally {
      flushProgress();
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

ipcMain.handle("sync:execute-rate", (_event, raw: unknown): void => {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return;
  execController?.setRateLimit(raw);
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

app.on("before-quit", () => {
  hashPool?.destroy();
  hashPool = null;
  mainDb?.close();
  mainDb = null;
});

app.whenReady().then(async () => {
  await loadMainDb();
  /* 不设应用菜单：目录对与目录选择都在扫描设置页里 */
  Menu.setApplicationMenu(null);
  log.info(
    `[start] electron=${process.versions.electron} node=${process.versions.node} ` +
      `pairs=${mainDb?.list().length ?? 0} recent=${mainDb?.recent().length ?? 0} ` +
      `scanThreads=${readScanThreads()} log=${logPath}`,
  );
  mainWindow = createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
