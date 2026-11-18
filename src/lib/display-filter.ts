import { extMatch } from "./exts";
import type { DiffRow, RelPath } from "./types";

export type KeywordMode = "include" | "exclude";
export type SuffixMode = "include" | "exclude";

export interface DisplayFilter {
  keywordMode: KeywordMode;
  /** 单个词，空字符串表示不限制 */
  keyword: string;
  suffixMode: SuffixMode;
  /** 已归一化的后缀列表（带前导点），空表示不限制 */
  suffixes: string[];
  /** YYYY-MM-DD，空表示不限 */
  dateFrom: string;
  dateTo: string;
  /** 字节；0 表示不限 */
  sizeMin: number;
  sizeMax: number;
  /** 0 表示不限；1 只显示根目录文件 */
  depth: number;
  skipHidden: boolean;
}

function pathsOf(row: DiffRow): RelPath[] {
  const paths: RelPath[] = [];
  if (row.left) paths.push(row.left);
  if (row.right) paths.push(row.right);
  return paths;
}

/** 关键字：任一侧相对路径或文件名包含即命中 */
function keywordHit(paths: RelPath[], keyword: string): boolean {
  if (!keyword) return false;
  const lower = keyword.toLowerCase();
  return paths.some((path) => path.toLowerCase().includes(lower));
}

/** 后缀：任一侧文件名命中任一后缀 */
function suffixHit(paths: RelPath[], suffixes: string[]): boolean {
  if (suffixes.length === 0) return false;
  return paths.some((path) => extMatch(path.split("/").pop() ?? path, suffixes));
}

/** 日期：任一侧修改日期落在范围内 */
function dateInRange(row: DiffRow, after: number, before: number): boolean {
  const dates = [row.leftDate, row.rightDate].filter((date): date is number => date !== null);
  if (dates.length === 0) return false;
  return dates.some((date) => (after === 0 || date >= after) && (before === 0 || date <= before));
}

/** 大小：任一侧大小落在范围内 */
function sizeInRange(row: DiffRow, min: number, max: number): boolean {
  const sizes = [row.leftSize, row.rightSize].filter((size): size is number => size !== null);
  if (sizes.length === 0) return false;
  return sizes.some((size) => (min === 0 || size >= min) && (max === 0 || size <= max));
}

/** 层级：任一侧路径层级不超过上限（段数） */
function depthWithin(paths: RelPath[], depth: number): boolean {
  return paths.some((path) => path.split("/").length <= depth);
}

/** 隐藏文件：任一侧路径的任一段以 . 开头 */
function hasHiddenSegment(paths: RelPath[]): boolean {
  return paths.some((path) => path.split("/").some((segment) => segment.startsWith(".")));
}

/** 显示过滤：任一侧满足即显示；空条件不限制 */
export function matchesDisplayFilter(row: DiffRow, filter: DisplayFilter): boolean {
  const paths = pathsOf(row);
  if (paths.length === 0) return false;

  if (filter.keywordMode === "include" && filter.keyword && !keywordHit(paths, filter.keyword)) {
    return false;
  }
  if (filter.keywordMode === "exclude" && keywordHit(paths, filter.keyword)) {
    return false;
  }

  if (filter.suffixMode === "include" && filter.suffixes.length > 0) {
    if (!suffixHit(paths, filter.suffixes)) return false;
  }
  if (filter.suffixMode === "exclude" && suffixHit(paths, filter.suffixes)) {
    return false;
  }

  if (filter.dateFrom || filter.dateTo) {
    const after = filter.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`).getTime() : 0;
    const before = filter.dateTo ? new Date(`${filter.dateTo}T23:59:59.999`).getTime() : 0;
    if (!dateInRange(row, after, before)) return false;
  }

  if (
    (filter.sizeMin > 0 || filter.sizeMax > 0) &&
    !sizeInRange(row, filter.sizeMin, filter.sizeMax)
  ) {
    return false;
  }

  if (filter.depth > 0 && !depthWithin(paths, filter.depth)) return false;

  if (filter.skipHidden && hasHiddenSegment(paths)) return false;

  return true;
}
