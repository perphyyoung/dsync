import { contextBridge, ipcRenderer } from "electron";
import type { DirPairEntry } from "../src/lib/dir-pairs";
import type { ScanProgress } from "../src/lib/types";
import type {
  AppSettings,
  DeletedRecord,
  ExecuteProgress,
  ExecuteRequest,
  FilterPrefs,
  RecentPair,
  RecycleListRequest,
  RecycleRestoreRequest,
  RefreshRequest,
  RefreshedRow,
  RehashRequest,
  RehashResult,
  ScanOutcome,
  ScanRequest,
} from "../src/lib/types";

contextBridge.exposeInMainWorld("api", {
  pickDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke("dir:pick", defaultPath),
  openDirectory: (path: string): Promise<void> => ipcRenderer.invoke("dir:open", path),
  checkDirs: (paths: string[]): Promise<boolean[]> => ipcRenderer.invoke("dirs:check", paths),
  scan: (request: ScanRequest): Promise<ScanOutcome> => ipcRenderer.invoke("sync:scan", request),
  pauseScan: (): Promise<void> => ipcRenderer.invoke("sync:pause"),
  resumeScan: (): Promise<void> => ipcRenderer.invoke("sync:resume"),
  cancelScan: (): Promise<void> => ipcRenderer.invoke("sync:cancel"),
  execute: (request: ExecuteRequest) => ipcRenderer.invoke("sync:execute", request),
  pauseExecute: (): Promise<void> => ipcRenderer.invoke("sync:execute-pause"),
  resumeExecute: (): Promise<void> => ipcRenderer.invoke("sync:execute-resume"),
  cancelExecute: (): Promise<void> => ipcRenderer.invoke("sync:execute-cancel"),
  setExecuteRate: (bytesPerSec: number): Promise<void> =>
    ipcRenderer.invoke("sync:execute-rate", bytesPerSec),
  rehash: (request: RehashRequest): Promise<RehashResult> =>
    ipcRenderer.invoke("sync:rehash", request),
  refresh: (request: RefreshRequest): Promise<RefreshedRow[]> =>
    ipcRenderer.invoke("sync:refresh", request),
  listRecent: (): Promise<RecentPair[]> => ipcRenderer.invoke("recent:list"),
  listPairs: (): Promise<DirPairEntry[]> => ipcRenderer.invoke("pairs:list"),
  savePairFilters: (input: { left: string; right: string; filters: FilterPrefs }): Promise<void> =>
    ipcRenderer.invoke("pairs:save", input),
  removePair: (input: { left: string; right: string }): Promise<void> =>
    ipcRenderer.invoke("pairs:remove", input),
  getAppSettings: (): Promise<AppSettings> => ipcRenderer.invoke("settings:get"),
  setScanThreads: (value: number): Promise<AppSettings> =>
    ipcRenderer.invoke("settings:set-scan-threads", value),
  resetScanThreads: (): Promise<AppSettings> => ipcRenderer.invoke("settings:reset-scan-threads"),
  listRecycle: (request: RecycleListRequest): Promise<DeletedRecord[]> =>
    ipcRenderer.invoke("recycle:list", request),
  restoreRecycle: (request: RecycleRestoreRequest): Promise<string> =>
    ipcRenderer.invoke("recycle:restore", request),
  onProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: ScanProgress): void => callback(progress);
    ipcRenderer.on("sync:progress", handler);
    return () => {
      ipcRenderer.off("sync:progress", handler);
    };
  },
  onExecuteProgress: (callback: (progress: ExecuteProgress) => void): (() => void) => {
    const handler = (_event: unknown, progress: ExecuteProgress): void => callback(progress);
    ipcRenderer.on("sync:execute-progress", handler);
    return () => {
      ipcRenderer.off("sync:execute-progress", handler);
    };
  },
  log: (level: string, message: string): Promise<void> =>
    ipcRenderer.invoke("log:renderer", level, message),
});
