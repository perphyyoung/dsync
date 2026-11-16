import type {
  DeletedRecord,
  ExecuteRequest,
  ExecuteResult,
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
  scan(request: ScanRequest): Promise<ScanOutcome>;
  pauseScan(): Promise<void>;
  resumeScan(): Promise<void>;
  cancelScan(): Promise<void>;
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  rehash(request: RehashRequest): Promise<RehashResult>;
  refresh(request: RefreshRequest): Promise<RefreshedRow[]>;
  listRecent(): Promise<RecentPair[]>;
  listRecycle(request: RecycleListRequest): Promise<DeletedRecord[]>;
  restoreRecycle(request: RecycleRestoreRequest): Promise<string>;
  onProgress(callback: (progress: ScanProgress) => void): () => void;
  onLoadRecent(callback: (pair: RecentPair) => void): () => void;
  log(level: string, message: string): Promise<void>;
}

declare global {
  interface Window {
    api: Api;
  }
}
