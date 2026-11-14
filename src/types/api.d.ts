import type { ScanProgress } from "../lib/pipeline";
import type {
  ExecuteRequest,
  ExecuteResult,
  RecentPair,
  ScanRequest,
  ScanResult,
} from "../lib/types";

export interface Api {
  pickDirectory(): Promise<string | null>;
  scan(request: ScanRequest): Promise<ScanResult>;
  execute(request: ExecuteRequest): Promise<ExecuteResult>;
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
