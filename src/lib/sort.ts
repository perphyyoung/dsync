import type { DiffRow } from "./types";

export type SortKey = "path" | "date" | "size";
export type SortDir = "asc" | "desc";

export interface SortableItem {
  row: DiffRow;
  index: number;
}

/** 双列视图下取存在的一侧；空值排末尾 */
function sortValue(row: DiffRow, key: SortKey): string | number | null {
  if (key === "path") return (row.left ?? row.right)?.toLowerCase() ?? null;
  if (key === "date") return row.leftDate ?? row.rightDate ?? null;
  return row.leftSize ?? row.rightSize ?? null;
}

export function sortItems(items: SortableItem[], key: SortKey, dir: SortDir): SortableItem[] {
  const sign = dir === "asc" ? 1 : -1;
  return items.toSorted((a, b) => {
    const left = sortValue(a.row, key);
    const right = sortValue(b.row, key);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    if (left < right) return -1 * sign;
    if (left > right) return sign;
    return 0;
  });
}
