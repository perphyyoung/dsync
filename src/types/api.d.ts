import type {
  ExecuteRequest,
  ExecuteResult,
  RecentPair,
  RefreshRequest,
  RefreshedRow,
  RehashRequest,
  RehashResult,
  ScanOutcome,
  ScanProgress,
  ScanRequest,
} from "../lib/types";

export interface Api {
  pickDirectory(): Promise<string | null>;
  scan(request: ScanRequest): Promise<ScanOutcome>;
  pauseScan(): Promise<void>;
  resumeScan(): Promise<void>;
  cancelScan(): Promise<void>;
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
  rehash(request: RehashRequest): Promise<RehashResult>;
  refresh(request: RefreshRequest): Promise<RefreshedRow[]>;
  listRecent(): Promise<RecentPair[]>;
  onProgress(callback: (progress: ScanProgress) => void): () => void;
  onLoadRecent(callback: (pair: RecentPair) => void): () => void;
  log(level: string, message: string): Promise<void>;
}

declare global {
  interface Window {
    api: Api;
  }
}
