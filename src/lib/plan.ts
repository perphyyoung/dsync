import type { IgnoredFile } from "./scan";
import type {
  AlignMode,
  DiffRow,
  FileEntry,
  PairRecord,
  RelPath,
  RowStatus,
  ScanStats,
  Side,
  SyncAction,
} from "./types";

export interface PlanInput {
  pairs: PairRecord[];
  left: Map<RelPath, FileEntry>;
  right: Map<RelPath, FileEntry>;
  leftOnly: RelPath[];
  rightOnly: RelPath[];
  ignored: IgnoredFile[];
}

export interface PlanOutcome {
  rows: DiffRow[];
  stats: ScanStats;
}

const IGNORE_NOTE: Record<IgnoredFile["reason"], string> = {
  internal: "内部文件",
  size: "小于最小大小",
  ext: "后缀被过滤",
  symlink: "符号链接",
  special: "特殊文件",
  unreadable: "读取失败",
};

function otherSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

/** 扫描只负责出差异行，不含任何方向与路径改写信息 */
function buildRows(input: PlanInput): DiffRow[] {
  const rows: DiffRow[] = [];

  for (const pair of input.pairs) {
    const leftEntry = input.left.get(pair.left);
    const rightEntry = input.right.get(pair.right);
    if (!leftEntry || !rightEntry) continue;

    const sameHash = leftEntry.hash === rightEntry.hash;
    const samePath = pair.left.toLowerCase() === pair.right.toLowerCase();
    const status: RowStatus = sameHash ? (samePath ? "same" : "moved") : "diff";

    rows.push({
      status,
      left: pair.left,
      right: pair.right,
      leftSize: leftEntry.size,
      rightSize: rightEntry.size,
      leftHash: leftEntry.hash,
      rightHash: rightEntry.hash,
      base: pair.base,
      pairedBy: pair.pairedBy,
      note: null,
    });
  }

  for (const path of input.leftOnly) {
    const entry = input.left.get(path);
    rows.push({
      status: "left-only",
      left: path,
      right: null,
      leftSize: entry?.size ?? null,
      rightSize: null,
      leftHash: entry?.hash ?? null,
      rightHash: null,
      base: null,
      pairedBy: null,
      note: null,
    });
  }

  for (const path of input.rightOnly) {
    const entry = input.right.get(path);
    rows.push({
      status: "right-only",
      left: null,
      right: path,
      leftSize: null,
      rightSize: entry?.size ?? null,
      leftHash: null,
      rightHash: entry?.hash ?? null,
      base: null,
      pairedBy: null,
      note: null,
    });
  }

  for (const item of input.ignored) {
    rows.push({
      status: "ignored",
      left: item.path,
      right: item.path,
      leftSize: item.size,
      rightSize: item.size,
      leftHash: null,
      rightHash: null,
      base: null,
      pairedBy: null,
      note: IGNORE_NOTE[item.reason],
    });
  }

  return rows;
}

/**
 * 生成「让 side 侧与对侧对齐」的动作。操作列的单行操作与批量执行共用这套规则。
 * align 为 keep 时只改内容，align-* 时目标路径取对侧的相对路径。
 */
export function actionForRow(
  row: DiffRow,
  side: Side,
  rowIndex: number,
  align: AlignMode = "keep",
): SyncAction[] {
  if (row.status === "same" || row.status === "ignored" || row.status === "target-blocked") {
    return [];
  }

  const currentPath = row[side];
  const sourcePath = row[otherSide(side)];
  const targetPath = align === "keep" ? currentPath : sourcePath;

  if (row.status === "moved") {
    if (align === "keep" || !currentPath || !targetPath) return [];
    if (currentPath.toLowerCase() === targetPath.toLowerCase()) return [];
    return [
      {
        kind: "move",
        side,
        fromPath: currentPath,
        toPath: targetPath,
        status: row.status,
        rowIndex,
      },
    ];
  }

  if (row.status === "diff") {
    if (!sourcePath || !targetPath) return [];
    const actions: SyncAction[] = [
      {
        kind: "copy",
        side,
        fromPath: sourcePath,
        toPath: targetPath,
        status: row.status,
        rowIndex,
      },
    ];
    if (align !== "keep" && currentPath && currentPath.toLowerCase() !== targetPath.toLowerCase()) {
      actions.push({
        kind: "delete",
        side,
        fromPath: null,
        toPath: currentPath,
        status: row.status,
        rowIndex,
      });
    }
    return actions;
  }

  // 只有对侧存在才需要复制；本侧独有属于「多余」，默认保留不动
  if (!currentPath && sourcePath) {
    return [
      {
        kind: "copy",
        side,
        fromPath: sourcePath,
        toPath: sourcePath,
        status: row.status,
        rowIndex,
      },
    ];
  }
  return [];
}

function countStats(rows: DiffRow[]): ScanStats {
  const stats: ScanStats = {
    same: 0,
    moved: 0,
    diff: 0,
    leftOnly: 0,
    rightOnly: 0,
    ignored: 0,
  };
  for (const row of rows) {
    switch (row.status) {
      case "same":
        stats.same += 1;
        break;
      case "moved":
        stats.moved += 1;
        break;
      case "diff":
        stats.diff += 1;
        break;
      case "left-only":
        stats.leftOnly += 1;
        break;
      case "right-only":
        stats.rightOnly += 1;
        break;
      case "ignored":
        stats.ignored += 1;
        break;
      case "target-blocked":
        break;
    }
  }
  return stats;
}

export function planSync(input: PlanInput): PlanOutcome {
  const rows = buildRows(input);
  return { rows, stats: countStats(rows) };
}
