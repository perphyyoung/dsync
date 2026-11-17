import type { FilterPrefs } from "./types";

/** 每个目录对一条记录；按最近使用排序 */
export interface DirPairEntry {
  left: string;
  right: string;
  /** 最后一次扫描成功时间；null 表示只存过条件、还没扫描过 */
  usedAt: string | null;
  /** 扫描条件快照；null 表示没有存档 */
  filters: FilterPrefs | null;
}

export const MAX_DIR_PAIRS = 100;
export const RECENT_PAIR_LIMIT = 10;

/** 左右顺序无关：排序后拼接，大小写不敏感 */
export function pairKey(left: string, right: string): string {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}
