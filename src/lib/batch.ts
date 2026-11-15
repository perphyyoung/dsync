import type { BatchStats, DiffRow, Side } from "./types";

function otherSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

/**
 * 找出目标路径已被其他行占用的行。
 * 不做「链式腾挪」：即使占用者自己也会被改写，顺序执行仍可能丢数据，宁可让用户手工处理。
 * 只在重排路径时才有意义：把基准侧路径套到被改写侧时才会撞上别的文件。
 */
export function detectTargetConflicts(
  rows: DiffRow[],
  selected: Set<number>,
  side: Side,
): Set<number> {
  const other = otherSide(side);
  const conflicts = new Set<number>();

  // 被改写侧现有的路径 → 属于哪一行
  const occupiedBy = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.status === "ignored") return;
    const path = row[side];
    if (path) occupiedBy.set(path.toLowerCase(), index);
  });

  for (const index of selected) {
    const row = rows[index];
    if (!row) continue;
    const target = row[other];
    if (!target) continue;
    const owner = occupiedBy.get(target.toLowerCase());
    if (owner === undefined || owner === index) continue;
    conflicts.add(index);
  }

  return conflicts;
}

/** 统计批量执行会在被改写侧造成多少新增 / 修改 / 删除 */
export function computeBatchStats(
  rows: DiffRow[],
  selected: Set<number>,
  side: Side,
  reorder: boolean,
): BatchStats {
  const other = otherSide(side);
  const conflicts = reorder ? detectTargetConflicts(rows, selected, side) : new Set<number>();
  const stats: BatchStats = {
    rows: 0,
    added: 0,
    modified: 0,
    deleted: 0,
    blocked: conflicts.size,
  };

  for (const index of selected) {
    const row = rows[index];
    if (!row || conflicts.has(index)) continue;
    if (row.status === "ignored" || row.status === "duplicate" || row.status === "target-blocked") {
      continue;
    }

    const current = row[side];
    const source = row[other];

    if (!source) {
      if (current) {
        stats.deleted += 1;
        stats.rows += 1;
      }
      continue;
    }
    if (!current) {
      stats.added += 1;
      stats.rows += 1;
      continue;
    }
    if (row.status === "moved" && reorder) {
      stats.modified += 1;
      stats.rows += 1;
    }
  }

  return stats;
}
