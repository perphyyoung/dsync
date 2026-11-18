import type { IgnoredFile } from "./scan";
import type {
  AlignMode,
  DiffRow,
  FileEntry,
  PairRecord,
  RelPath,
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
  leftIgnored: IgnoredFile[];
  rightIgnored: IgnoredFile[];
}

export interface PlanOutcome {
  rows: DiffRow[];
  stats: ScanStats;
}

const IGNORE_NOTE: Record<IgnoredFile["reason"], string> = {
  symlink: "符号链接",
  special: "特殊文件",
  unreadable: "读取失败",
};

function otherSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

function hashCount(files: Map<RelPath, FileEntry>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of files.values()) {
    counts.set(entry.hash, (counts.get(entry.hash) ?? 0) + 1);
  }
  return counts;
}

/** 扫描只负责出差异行，不含任何方向与路径改写信息 */
function buildRows(input: PlanInput): DiffRow[] {
  const rows: DiffRow[] = [];

  for (const pair of input.pairs) {
    const leftEntry = input.left.get(pair.left);
    const rightEntry = input.right.get(pair.right);
    if (!leftEntry || !rightEntry) continue;

    const samePath = pair.left.toLowerCase() === pair.right.toLowerCase();
    rows.push({
      status: samePath ? "same" : "moved",
      left: pair.left,
      right: pair.right,
      leftSize: leftEntry.size,
      rightSize: rightEntry.size,
      leftDate: leftEntry.mtimeMs,
      rightDate: rightEntry.mtimeMs,
      leftHash: leftEntry.hash,
      rightHash: rightEntry.hash,
      base: pair.base,
      pairedBy: pair.pairedBy,
      note: null,
    });
  }

  // 两侧同路径、内容不同且都没配上：互相占位，谁都动不了
  const rightOnlySet = new Set(input.rightOnly);
  const blocked = new Set<RelPath>();
  for (const path of input.leftOnly) {
    if (!rightOnlySet.has(path)) continue;
    const leftEntry = input.left.get(path);
    const rightEntry = input.right.get(path);
    if (!leftEntry || !rightEntry) continue;
    blocked.add(path);
    rows.push({
      status: "target-blocked",
      left: path,
      right: path,
      leftSize: leftEntry.size,
      rightSize: rightEntry.size,
      leftDate: leftEntry.mtimeMs,
      rightDate: rightEntry.mtimeMs,
      leftHash: leftEntry.hash,
      rightHash: rightEntry.hash,
      base: null,
      pairedBy: null,
      note: "两侧同名但内容不同",
    });
  }

  const leftCounts = hashCount(input.left);
  const rightCounts = hashCount(input.right);

  for (const path of input.leftOnly) {
    if (blocked.has(path)) continue;
    const entry = input.left.get(path);
    const duplicated = entry ? (leftCounts.get(entry.hash) ?? 0) > 1 : false;
    rows.push({
      status: duplicated ? "duplicate" : "left-only",
      left: path,
      right: null,
      leftSize: entry?.size ?? null,
      rightSize: null,
      leftDate: entry?.mtimeMs ?? null,
      rightDate: null,
      leftHash: entry?.hash ?? null,
      rightHash: null,
      base: null,
      pairedBy: null,
      note: duplicated ? "本侧有多个内容相同的文件" : null,
    });
  }

  for (const path of input.rightOnly) {
    if (blocked.has(path)) continue;
    const entry = input.right.get(path);
    const duplicated = entry ? (rightCounts.get(entry.hash) ?? 0) > 1 : false;
    rows.push({
      status: duplicated ? "duplicate" : "right-only",
      left: null,
      right: path,
      leftSize: null,
      rightSize: entry?.size ?? null,
      leftDate: null,
      rightDate: entry?.mtimeMs ?? null,
      leftHash: null,
      rightHash: entry?.hash ?? null,
      base: null,
      pairedBy: null,
      note: duplicated ? "本侧有多个内容相同的文件" : null,
    });
  }

  const leftIgnored = new Map(input.leftIgnored.map((item) => [item.path, item]));
  const rightIgnored = new Map(input.rightIgnored.map((item) => [item.path, item]));
  const ignoredPaths = new Set([...leftIgnored.keys(), ...rightIgnored.keys()]);
  for (const path of ignoredPaths) {
    const leftItem = leftIgnored.get(path);
    const rightItem = rightIgnored.get(path);
    const leftNote = leftItem ? IGNORE_NOTE[leftItem.reason] : null;
    const rightNote = rightItem ? IGNORE_NOTE[rightItem.reason] : null;
    rows.push({
      status: "ignored",
      left: leftItem ? path : null,
      right: rightItem ? path : null,
      leftSize: leftItem?.size ?? null,
      rightSize: rightItem?.size ?? null,
      leftDate: leftItem?.mtimeMs ?? null,
      rightDate: rightItem?.mtimeMs ?? null,
      leftHash: null,
      rightHash: null,
      base: null,
      pairedBy: null,
      note:
        leftNote && rightNote && leftNote !== rightNote
          ? `左：${leftNote}；右：${rightNote}`
          : (leftNote ?? rightNote),
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
  if (
    row.status === "same" ||
    row.status === "ignored" ||
    row.status === "target-blocked" ||
    row.status === "duplicate"
  ) {
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

  // 本侧有、对侧没有：以对侧为准时本侧多余，软删除
  if (currentPath && !sourcePath) {
    return [
      {
        kind: "soft-delete",
        side,
        fromPath: null,
        toPath: currentPath,
        status: row.status,
        rowIndex,
      },
    ];
  }

  // 本侧没有、对侧有：复制过来
  if (!currentPath && sourcePath) {
    const sourceHash = side === "left" ? row.rightHash : row.leftHash;
    return [
      {
        kind: "copy",
        side,
        fromPath: sourcePath,
        toPath: sourcePath,
        status: row.status,
        rowIndex,
        ...(sourceHash ? { sourceHash } : {}),
      },
    ];
  }
  return [];
}

function countStats(rows: DiffRow[]): ScanStats {
  const stats: ScanStats = {
    same: 0,
    moved: 0,
    duplicateLeft: 0,
    duplicateRight: 0,
    leftOnly: 0,
    rightOnly: 0,
    ignored: 0,
    targetBlocked: 0,
  };
  for (const row of rows) {
    switch (row.status) {
      case "same":
        stats.same += 1;
        break;
      case "moved":
        stats.moved += 1;
        break;
      case "duplicate":
        if (row.left) stats.duplicateLeft += 1;
        else stats.duplicateRight += 1;
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
        stats.targetBlocked += 1;
        break;
    }
  }
  return stats;
}

export function planSync(input: PlanInput): PlanOutcome {
  const rows = buildRows(input);
  return { rows, stats: countStats(rows) };
}
