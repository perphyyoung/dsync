import type { DirPairEntry } from "../lib/dir-pairs";
import type {
  DeletedRecord,
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
  scan(request: ScanRequest): Promise<ScanOutcome>;
  pauseScan(): Promise<void>;
  resumeScan(): Promise<void>;
  cancelScan(): Promise<void>;
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  rehash(request: RehashRequest): Promise<RehashResult>;
  refresh(request: RefreshRequest): Promise<RefreshedRow[]>;
  listRecent(): Promise<RecentPair[]>;
  listPairs(): Promise<DirPairEntry[]>;
  savePairFilters(input: { left: string; right: string; filters: FilterPrefs }): Promise<void>;
  listRecycle(request: RecycleListRequest): Promise<DeletedRecord[]>;
  restoreRecycle(request: RecycleRestoreRequest): Promise<string>;
  onProgress(callback: (progress: ScanProgress) => void): () => void;
  log(level: string, message: string): Promise<void>;
}

declare global {
  interface Window {
    api: Api;
  }
}
