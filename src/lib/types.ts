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
  | "duplicate"
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
  /** 修改日期（毫秒时间戳），界面只显示到天 */
  leftDate: number | null;
  rightDate: number | null;
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
  /** 0 表示不限；超过上限的文件被过滤 */
  maxSize: number;
  /** 0 表示不限；正整数限制目录深度，1 只扫根目录文件 */
  maxDepth: number;
  /** 只含关键字：相对路径或文件名包含才扫描；空字符串表示不限 */
  includeKeyword: string;
  /** 排除关键字：相对路径或文件名包含即跳过；空字符串表示不限 */
  excludeKeyword: string;
  /** 修改日期下界（毫秒时间戳，按日期换算），0 表示不限 */
  modifiedAfter: number;
  /** 修改日期上界（毫秒时间戳，按日期换算），0 表示不限 */
  modifiedBefore: number;
  /** 跳过以 . 开头的文件与目录 */
  skipHidden: boolean;
  includeExts: string[];
  excludeExts: string[];
}

export interface ScanRequest extends FilterOptions {
  leftRoot: string;
  rightRoot: string;
  /** 强制重算：不使用哈希缓存，本次重新读取所有文件 */
  forceRehash: boolean;
}

/** 文件列表的显示视角：全部 / 左侧 / 右侧 / 重复 / 目标占用 / 特殊 */
export type ViewMode = "all" | "left" | "right" | "duplicate" | "blocked" | "special";

export interface ScanStats {
  same: number;
  moved: number;
  /** 左侧存在多个内容相同的文件，无法确定配对对象 */
  duplicateLeft: number;
  /** 同上，右侧 */
  duplicateRight: number;
  leftOnly: number;
  rightOnly: number;
  ignored: number;
  targetBlocked: number;
}

export interface ScanResult {
  rows: DiffRow[];
  stats: ScanStats;
  /** 索引损坏、校验不符等提示，不阻断扫描 */
  warnings: string[];
}

/** sync:scan 的返回：用户取消时没有结果 */
export interface ScanOutcome {
  cancelled: boolean;
  result?: ScanResult;
}

/** 单行重算：路径可为 null，表示该侧不存在 */
export interface RehashRequest {
  leftRoot: string;
  rightRoot: string;
  left: RelPath | null;
  right: RelPath | null;
}

export interface RehashResult {
  leftHash: string | null;
  rightHash: string | null;
}

export type ScanPhase = "scan" | "hash" | "pair" | "index";

export interface ScanProgress {
  phase: ScanPhase;
  /** 阶段内已完成计数：扫描是文件数，哈希是字节数 */
  done: number;
  /** 阶段总计数；扫描收集期没有分母，为 0 */
  total: number;
  /** 当前处理的相对路径 */
  current: string;
  /** 收集阶段已发现的文件数 */
  discovered?: number;
  /** 预计剩余秒数；null 表示样本不足 */
  etaSeconds?: number | null;
}

/**
 * side 是「被改写的一侧」，fromPath 是对侧（或同侧的旧路径）。
 * copy: 从对侧复制到 side；move: 在 side 内改名；soft-delete: 把 side 上的文件移入内置回收站。
 */
export interface SyncAction {
  kind: "copy" | "move" | "soft-delete";
  side: Side;
  fromPath: RelPath | null;
  toPath: RelPath;
  status: RowStatus;
  /** 对应 ScanResult.rows 的下标，供界面按行勾选 */
  rowIndex: number;
  /** copy 时源侧扫描哈希：执行时用它校验目标，不重读源 */
  sourceHash?: string | null;
  /** copy 时源文件扫描大小；用于多文件聚合进度 */
  sizeBytes?: number;
}

export interface ExecuteRequest {
  leftRoot: string;
  rightRoot: string;
  actions: SyncAction[];
  /** 复制限速（字节/秒），0 或不传表示不限；执行中可通过 IPC 调整 */
  rateLimitBytesPerSec?: number;
}

/** 磁盘类型：auto 自动检测，ssd / hdd 手动覆盖 */
export type DiskMode = "auto" | "ssd" | "hdd";

/** 应用级设置：存 dsync-main.db 的 app_settings 表 */
export interface AppSettings {
  /** 实际生效的扫描线程数 */
  scanThreads: number;
  /** true 表示用默认值（逻辑处理器一半），false 表示用户显式设置 */
  scanThreadsAuto: boolean;
  /** 实际生效的复制线程数（单文件分块并发） */
  copyThreads: number;
  /** true 表示用默认值（SSD 下 max(2, 一半)），false 表示用户显式设置 */
  copyThreadsAuto: boolean;
  /** 实际生效的并行文件数（多文件复制） */
  parallelFiles: number;
  /** true 表示用默认值（max(2, 一半)），false 表示用户显式设置 */
  parallelFilesAuto: boolean;
  diskMode: DiskMode;
  /** 复制完成后自动关闭执行进度窗；false 时保留窗口查看用时与平均速度 */
  autoCloseExecWindow: boolean;
  /** 当前机器可见的逻辑处理器数 */
  logicalProcessors: number;
}

/** 执行进度：done 为已完成动作数；fileBytes* 仅当前大文件复制时有值 */
export interface ExecuteProgress {
  done: number;
  total: number;
  currentPath: string;
  fileBytesDone: number;
  fileBytesTotal: number;
  /** 当前文件复制速度（字节/秒），未知为 0 */
  bytesPerSecond: number;
  /** 当前文件预计剩余秒数；样本不足为 null */
  etaSeconds: number | null;
  /** 所有 copy 动作的聚合已复制字节 */
  bytesDone: number;
  /** 所有 copy 动作的聚合总字节 */
  bytesTotal: number;
  /** 当前同时复制的文件数 */
  activeFiles: number;
  /** 当前正在校验哈希的文件数 */
  verifyingFiles: number;
}

/** 局部刷新：只检查给定行的两侧文件 */
export interface RefreshTarget {
  rowIndex: number;
  left: RelPath | null;
  right: RelPath | null;
}

export interface RefreshedFile {
  path: RelPath;
  hash: string;
  size: number;
  mtimeMs: number;
}

export interface RefreshedRow {
  rowIndex: number;
  left: RefreshedFile | null;
  right: RefreshedFile | null;
}

export interface RefreshRequest {
  leftRoot: string;
  rightRoot: string;
  targets: RefreshTarget[];
}

/** 文件在扫描后已被外部改动，对应动作不执行 */
export interface StaleEntry {
  path: RelPath;
  reason: "source-changed" | "target-changed" | "target-created";
}

/** 执行后校验：实际结果与动作预期不符 */
export interface MismatchEntry {
  path: RelPath;
  expected: string;
  actual: string;
}

/** 一次成功移动，供索引缓存迁移使用 */
export interface MoveRecord {
  side: Side;
  from: RelPath;
  to: RelPath;
}

/** 一次成功复制，供索引缓存定点写入 */
export interface CopyRecord {
  side: Side;
  from: RelPath;
  to: RelPath;
  /** 校验通过的内容哈希 */
  hash: string;
  size: number;
  /** 目标 rename 后的修改时间 */
  mtimeMs: number;
  /** 源文件 stat 修改时间 */
  sourceMtimeMs: number;
}

export interface ExecuteResult {
  copied: number;
  /** 成功复制的字节总数，用于完成态计算平均速度 */
  copiedBytes: number;
  /** 本次执行耗时（毫秒） */
  elapsedMs: number;
  moved: number;
  deleted: number;
  failed: { path: string; message: string }[];
  /** 成功的移动；rename 不改内容，调用方据此迁移索引缓存 */
  moves: MoveRecord[];
  /** 成功的复制；调用方据此定点写入哈希缓存 */
  copies: CopyRecord[];
  /** 扫描后被外部改动、已跳过的动作 */
  stale: StaleEntry[];
  /** 用户取消：已完成动作保留，当前文件丢弃 */
  cancelled: boolean;
}

export interface RecycleListRequest {
  leftRoot: string;
  rightRoot: string;
}

export interface RecycleRestoreRequest {
  root: string;
  id: number;
}

/** 内置回收站的一条记录 */
export interface DeletedRecord {
  id: number;
  side: Side;
  /** 删除前的相对路径 */
  path: RelPath;
  deletedAt: string;
  size: number;
  /** 回收站目录里的文件名 */
  blob: string;
}

/** 大小过滤的单位；换算在界面层做，IPC 仍传字节 */
export type SizeUnit = "KB" | "MB" | "GB";

/** 时间范围三态：三种方式互斥，最多选一种 */
export type TimeMode = "none" | "recent" | "custom";

/** 扫描设置页的条件快照，按目录对持久化（大小存数值 + 各自单位） */
export interface FilterPrefs {
  sizeEnabled: boolean;
  sizeMin: number;
  sizeMax: number;
  sizeMinUnit: SizeUnit;
  sizeMaxUnit: SizeUnit;
  maxDepth: number;
  includeInput: string;
  excludeInput: string;
  includeKeywordInput: string;
  excludeKeywordInput: string;
  timeMode: TimeMode;
  dateFrom: string;
  dateTo: string;
  recentDays: number;
  skipHidden: boolean;
}

/** 最近使用的目录对，供启动时回填左右目录 */
export interface RecentPair {
  left: string;
  right: string;
  savedAt: string;
}

/** 批量执行的统计结果，数字都是「被改写那一侧」的变化 */
export interface BatchStats {
  /** 实际会执行的行数 */
  rows: number;
  added: number;
  modified: number;
  deleted: number;
  /** 目标路径被其他行占用、无法执行的行数 */
  blocked: number;
}
