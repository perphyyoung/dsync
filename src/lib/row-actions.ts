import { actionForRow } from "./plan";
import type { AlignMode, DiffRow, Side, SyncAction } from "./types";

export interface RowDirection {
  actions: SyncAction[];
  /** 该方向的动作会删除文件：纯删除，或改写后清理旧路径 */
  deletes: boolean;
}

export interface RowDirections {
  left: RowDirection;
  right: RowDirection;
}

function otherSide(side: Side): Side {
  return side === "left" ? "right" : "left";
}

function deleteAction(row: DiffRow, side: Side, index: number): SyncAction | null {
  const path = row[side];
  if (!path) return null;
  return {
    kind: "delete",
    side,
    fromPath: null,
    toPath: path,
    status: row.status,
    rowIndex: index,
  };
}

/**
 * 单行两个方向各自的动作。
 * - 对侧有文件：按「以对侧为准」改写本侧（复制 / 改名 / 顺带清理旧路径）
 * - 对侧没有文件：这个方向就等于把本侧删掉
 */
function buildDirection(row: DiffRow, side: Side, index: number, mode: AlignMode): RowDirection {
  if (row[otherSide(side)] === null) {
    const action = deleteAction(row, side, index);
    return action ? { actions: [action], deletes: true } : { actions: [], deletes: false };
  }
  const actions = actionForRow(row, side, index, mode);
  return { actions, deletes: actions.some((item) => item.kind === "delete") };
}

/** left 是「以右为准改写左侧」，right 是「以左为准改写右侧」 */
export function rowDirections(row: DiffRow, index: number): RowDirections {
  return {
    left: buildDirection(row, "left", index, "align-right"),
    right: buildDirection(row, "right", index, "align-left"),
  };
}
