import { contextBridge, ipcRenderer } from "electron";
import type { ScanProgress } from "../src/lib/types";
import type {
  DeletedRecord,
  ExecuteRequest,
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
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("dir:pick"),
  scan: (request: ScanRequest): Promise<ScanOutcome> => ipcRenderer.invoke("sync:scan", request),
  pauseScan: (): Promise<void> => ipcRenderer.invoke("sync:pause"),
  resumeScan: (): Promise<void> => ipcRenderer.invoke("sync:resume"),
  cancelScan: (): Promise<void> => ipcRenderer.invoke("sync:cancel"),
  execute: (request: ExecuteRequest) => ipcRenderer.invoke("sync:execute", request),
  rehash: (request: RehashRequest): Promise<RehashResult> =>
    ipcRenderer.invoke("sync:rehash", request),
  refresh: (request: RefreshRequest): Promise<RefreshedRow[]> =>
    ipcRenderer.invoke("sync:refresh", request),
  listRecent: (): Promise<RecentPair[]> => ipcRenderer.invoke("recent:list"),
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
  onLoadRecent: (callback: (pair: RecentPair) => void): (() => void) => {
    const handler = (_event: unknown, pair: RecentPair): void => callback(pair);
    ipcRenderer.on("recent:load", handler);
    return () => {
      ipcRenderer.off("recent:load", handler);
    };
  },
  log: (level: string, message: string): Promise<void> =>
    ipcRenderer.invoke("log:renderer", level, message),
});
