/** 相对根目录、统一以 / 分隔的路径 */
export type RelPath = string;

export type Side = "left" | "right";

export type PairedBy = "index" | "path" | "name" | "hash" | "manual" | "inherited";

/** 扫描阶段拿到的文件元信息，不含哈希 */
export interface FileStat {
  path: RelPath;
  size: number;
  mtimeMs: number;
}

/** 补上内容哈希之后的文件条目 */
export interface FileEntry extends FileStat {
  hash: string;
}

/** 用于跳过重复计算的哈希缓存 */
export interface HashCache {
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface PairRecord {
  left: RelPath;
  right: RelPath;
  /** 上一次两侧一致时的哈希；null 表示从未打通 */
  base: string | null;
  leftCache: HashCache | null;
  rightCache: HashCache | null;
  pairedBy: PairedBy;
  syncedAt: string | null;
}

export interface IndexRoots {
  left: string;
  right: string;
}

export interface IndexData {
  version: number;
  updatedAt: string;
  roots: IndexRoots;
  pairs: PairRecord[];
}

export type RowStatus =
  | "same"
  | "moved"
  | "diff"
  | "left-only"
  | "right-only"
  | "ignored"
  | "target-blocked";

export interface DiffRow {
  status: RowStatus;
  left: RelPath | null;
  right: RelPath | null;
  leftSize: number | null;
  rightSize: number | null;
  leftHash: string | null;
  rightHash: string | null;
  base: string | null;
  pairedBy: PairedBy | null;
  /** 状态补充说明，如被忽略的原因 */
  note: string | null;
}

export type Direction = "none" | "left-to-right" | "right-to-left";

export type AlignMode = "keep" | "align-left" | "align-right";

export interface FilterOptions {
  minSize: number;
  includeExts: string[];
  excludeExts: string[];
}

export interface ScanRequest extends FilterOptions {
  leftRoot: string;
  rightRoot: string;
  direction: Direction;
  align: AlignMode;
  /** 忽略哈希缓存，全部重算 */
  ignoreCache: boolean;
}

export interface ScanStats {
  same: number;
  moved: number;
  diff: number;
  leftOnly: number;
  rightOnly: number;
  ignored: number;
  blocked: number;
}

export interface ScanResult {
  rows: DiffRow[];
  actions: SyncAction[];
  stats: ScanStats;
  /** 索引损坏、校验不符等提示，不阻断扫描 */
  warnings: string[];
}

/**
 * side 是「被修改的一侧」，fromPath 是对侧（或同侧的旧路径）。
 * copy: 从对侧复制到 side；move: 在 side 内改名；delete: 删除 side 上的文件。
 */
export interface SyncAction {
  kind: "copy" | "move" | "delete";
  side: Side;
  fromPath: RelPath | null;
  toPath: RelPath;
  status: RowStatus;
  /** 对应 ScanResult.rows 的下标，供界面按行勾选 */
  rowIndex: number;
}

export interface ExecuteRequest {
  leftRoot: string;
  rightRoot: string;
  actions: SyncAction[];
}

export interface ExecuteResult {
  copied: number;
  moved: number;
  deleted: number;
  failed: { path: string; message: string }[];
}

/** 最近使用的目录对，供「文件 → 最近目录对」菜单加载 */
export interface RecentPair {
  left: string;
  right: string;
  savedAt: string;
}
