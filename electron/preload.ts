import { contextBridge, ipcRenderer } from "electron";
import type { ScanProgress } from "../src/lib/pipeline";
import type { ExecuteRequest, RecentPair, ScanRequest, ScanResult } from "../src/lib/types";

contextBridge.exposeInMainWorld("api", {
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke("dir:pick"),
  scan: (request: ScanRequest): Promise<ScanResult> => ipcRenderer.invoke("sync:scan", request),
  execute: (request: ExecuteRequest) => ipcRenderer.invoke("sync:execute", request),
  listRecent: (): Promise<RecentPair[]> => ipcRenderer.invoke("recent:list"),
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
