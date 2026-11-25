import type { DiskKind } from "./types";

export interface DiskChangeResult {
  changed: boolean;
  /** filled 表示扫描快照缺失，已用当前检测结果回填 */
  reason?: "filled";
}

/** 对比扫描快照与执行前检测结果；快照缺失不视为变化 */
export function evaluateDiskChange(
  scan: { left: DiskKind; right: DiskKind } | null | undefined,
  now: { left: DiskKind; right: DiskKind },
): DiskChangeResult {
  if (!scan) return { changed: false, reason: "filled" };
  return { changed: scan.left !== now.left || scan.right !== now.right };
}
