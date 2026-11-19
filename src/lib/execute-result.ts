import type { DiffRow, RefreshedFile, RefreshedRow, Side, SyncAction } from "./types";

export interface DirectResult {
  /** 已成功执行、无需再读盘的行 */
  rows: RefreshedRow[];
  /** 缺少已知哈希 / 路径状态不确定，需要目标级刷新 */
  fallback: SyncAction[];
}

function fileOf(row: DiffRow, side: Side): RefreshedFile | null {
  const path = row[side];
  const hash = side === "left" ? row.leftHash : row.rightHash;
  const size = side === "left" ? row.leftSize : row.rightSize;
  if (!path || !hash || size === null) return null;
  return {
    path,
    hash,
    size,
    mtimeMs: (side === "left" ? row.leftDate : row.rightDate) ?? 0,
  };
}

/**
 * 应用内执行成功后直接算出行的新状态，不再重读目标文件。
 * copy 用执行前携带的 sourceHash；move / soft-delete 只改路径或置空。
 * 任一动作缺少可信哈希时整行回退到 refresh。
 */
export function directResults(
  rows: DiffRow[],
  actions: SyncAction[],
  now = Date.now(),
): DirectResult {
  const grouped = new Map<number, SyncAction[]>();
  for (const action of actions) {
    const list = grouped.get(action.rowIndex) ?? [];
    list.push(action);
    grouped.set(action.rowIndex, list);
  }

  const result: RefreshedRow[] = [];
  const fallback: SyncAction[] = [];
  for (const [rowIndex, list] of grouped) {
    const row = rows[rowIndex];
    if (!row) {
      fallback.push(...list);
      continue;
    }

    let left = fileOf(row, "left");
    let right = fileOf(row, "right");
    let ok = true;
    for (const action of list) {
      if (action.kind === "copy") {
        const source = action.side === "left" ? right : left;
        const hash = action.sourceHash ?? source?.hash;
        const size = action.sizeBytes ?? source?.size;
        if (!hash || size === undefined) {
          ok = false;
          break;
        }
        const target = { path: action.toPath, hash, size, mtimeMs: now };
        if (action.side === "left") left = target;
        else right = target;
        continue;
      }

      if (action.kind === "move") {
        const current = action.side === "left" ? left : right;
        if (!current) {
          ok = false;
          break;
        }
        const moved = { ...current, path: action.toPath };
        if (action.side === "left") left = moved;
        else right = moved;
        continue;
      }

      if (action.side === "left") left = null;
      else right = null;
    }

    if (ok) result.push({ rowIndex, left, right });
    else fallback.push(...list);
  }

  return { rows: result, fallback };
}
