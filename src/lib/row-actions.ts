import { actionForRow } from "./plan";
import type { AlignMode, DiffRow, Side, SyncAction } from "./types";

export interface RowDirection {
  actions: SyncAction[];
  /** 该方向的动作会软删除文件（对侧没有对应文件，或顺带清理旧路径） */
  deletes: boolean;
}

export interface RowDirections {
  left: RowDirection;
  right: RowDirection;
}

function buildDirection(row: DiffRow, side: Side, index: number, mode: AlignMode): RowDirection {
  const actions = actionForRow(row, side, index, mode);
  return { actions, deletes: actions.some((item) => item.kind === "soft-delete") };
}

/** left 是「以右为准改写左侧」，right 是「以左为准改写右侧」 */
export function rowDirections(row: DiffRow, index: number): RowDirections {
  return {
    left: buildDirection(row, "left", index, "align-right"),
    right: buildDirection(row, "right", index, "align-left"),
  };
}
