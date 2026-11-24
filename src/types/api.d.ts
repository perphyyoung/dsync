import type { DirPairEntry } from "../lib/dir-pairs";
import type {
  AppSettings,
  DeletedRecord,
  DiskMode,
  ExecuteProgress,
  ExecuteRequest,
  ExecuteResult,
  FilterPrefs,
  RecentPair,
  RecycleListRequest,
  RecycleRestoreRequest,
  RefreshRequest,
  RefreshedRow,
  RehashRequest,
  RehashResult,
  ScanOutcome,
  ScanProgress,
  ScanRequest,
} from "../lib/types";

export interface Api {
  pickDirectory(defaultPath?: string): Promise<string | null>;
  openDirectory(path: string): Promise<void>;
  checkDirs(paths: string[]): Promise<boolean[]>;
  scan(request: ScanRequest): Promise<ScanOutcome>;
  pauseScan(): Promise<void>;
  resumeScan(): Promise<void>;
  cancelScan(): Promise<void>;
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  pauseExecute(): Promise<void>;
  resumeExecute(): Promise<void>;
  cancelExecute(): Promise<void>;
  setExecuteRate(bytesPerSec: number): Promise<void>;
  rehash(request: RehashRequest): Promise<RehashResult>;
  refresh(request: RefreshRequest): Promise<RefreshedRow[]>;
  listRecent(): Promise<RecentPair[]>;
  listPairs(): Promise<DirPairEntry[]>;
  savePairFilters(input: { left: string; right: string; filters: FilterPrefs }): Promise<void>;
  removePair(input: { left: string; right: string }): Promise<void>;
  getAppSettings(): Promise<AppSettings>;
  setScanThreads(value: number): Promise<AppSettings>;
  resetScanThreads(): Promise<AppSettings>;
  setCopyThreads(value: number): Promise<AppSettings>;
  resetCopyThreads(): Promise<AppSettings>;
  setParallelFiles(value: number): Promise<AppSettings>;
  resetParallelFiles(): Promise<AppSettings>;
  setDiskMode(mode: DiskMode): Promise<AppSettings>;
  setAutoCloseExecWindow(value: boolean): Promise<AppSettings>;
  listRecycle(request: RecycleListRequest): Promise<DeletedRecord[]>;
  restoreRecycle(request: RecycleRestoreRequest): Promise<string>;
  onProgress(callback: (progress: ScanProgress) => void): () => void;
  onExecuteProgress(callback: (progress: ExecuteProgress) => void): () => void;
  log(level: string, message: string): Promise<void>;
}

declare global {
  interface Window {
    api: Api;
  }
}
