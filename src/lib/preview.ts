import { actionForRow } from "./plan";
import type { DiffRow, Side, SyncAction } from "./types";

export interface PreviewStats {
  copy: number;
  rename: number;
  softDelete: number;
  ignored: number;
}

export interface Preview {
  stats: PreviewStats;
  actions: SyncAction[];
}

export type PreviewKind = "copy" | "rename" | "softDelete";

/** 全选状态下每一类动作涉及的行号，供预览统计的批量开关使用（同一行去重） */
export function previewKindRows(rows: DiffRow[], side: Side): Record<PreviewKind, number[]> {
  const all = new Set(rows.map((_, index) => index));
  const groups: Record<PreviewKind, Set<number>> = {
    copy: new Set(),
    rename: new Set(),
    softDelete: new Set(),
  };
  for (const action of buildPreview(rows, all, side).actions) {
    if (action.kind === "copy") groups.copy.add(action.rowIndex);
    else if (action.kind === "move") groups.rename.add(action.rowIndex);
    else groups.softDelete.add(action.rowIndex);
  }
  return {
    copy: [...groups.copy],
    rename: [...groups.rename],
    softDelete: [...groups.softDelete],
  };
}

/**
 * 预览某个方向的批量结果：勾选的行全部参与，重排路径也包含在内。
 * 忽略 = 勾选但不可执行：一致 + 已忽略 + 重复 + 目标占用 + 重排目标被占。
 */
export function buildPreview(rows: DiffRow[], selected: Set<number>, side: Side): Preview {
  const other = side === "left" ? "right" : "left";
  const align = side === "left" ? "align-right" : "align-left";
  const actions: SyncAction[] = [];
  const stats: PreviewStats = { copy: 0, rename: 0, softDelete: 0, ignored: 0 };

  // 被改写侧现有路径 → 行号，用于判断重排目标是否被别的文件占住
  const occupied = new Map<string, number>();
  rows.forEach((row, index) => {
    const path = row[side];
    if (path) occupied.set(path.toLowerCase(), index);
  });

  rows.forEach((row, index) => {
    if (!selected.has(index)) return;
    if (
      row.status === "same" ||
      row.status === "ignored" ||
      row.status === "duplicate" ||
      row.status === "target-blocked"
    ) {
      stats.ignored += 1;
      return;
    }

    if (row.status === "moved") {
      const target = row[other];
      if (target) {
        const owner = occupied.get(target.toLowerCase());
        if (owner !== undefined && owner !== index) {
          stats.ignored += 1;
          return;
        }
      }
    }

    const rowActions = actionForRow(row, side, index, align);
    if (rowActions.length === 0) {
      stats.ignored += 1;
      return;
    }
    for (const action of rowActions) {
      actions.push(action);
      if (action.kind === "copy") stats.copy += 1;
      else if (action.kind === "move") stats.rename += 1;
      else stats.softDelete += 1;
    }
  });

  return { stats, actions };
}
