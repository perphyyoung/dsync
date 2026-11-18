import type { DisplayFilter } from "./display-filter";

/** 扫描条件里与显示范围相关的部分 */
export interface ScanScope {
  /** 字节；0 表示不限 */
  minSize: number;
  maxSize: number;
  /** 毫秒时间戳；0 表示不限 */
  modifiedAfter: number;
  modifiedBefore: number;
  skipHidden: boolean;
  /** 排除关键字（单关键词） */
  excludeKeyword: string;
}

export interface WiderReason {
  key: string;
  label: string;
}

/**
 * 判断显示条件是否超出扫描范围（需要重新扫描才能看到）。
 * 返回空数组表示显示只是缩小或不变。
 */
export function findWiderReasons(filter: DisplayFilter, scan: ScanScope): WiderReason[] {
  const reasons: WiderReason[] = [];

  if (scan.minSize > 0 && filter.sizeMin > 0 && filter.sizeMin < scan.minSize) {
    reasons.push({ key: "size-min", label: "显示大小下限低于扫描下限" });
  }
  if (scan.maxSize > 0 && filter.sizeMax > 0 && filter.sizeMax > scan.maxSize) {
    reasons.push({ key: "size-max", label: "显示大小上限高于扫描上限" });
  }

  const from = filter.dateFrom ? new Date(`${filter.dateFrom}T00:00:00`).getTime() : 0;
  const to = filter.dateTo ? new Date(`${filter.dateTo}T23:59:59.999`).getTime() : 0;
  if (scan.modifiedAfter > 0 && from > 0 && from < scan.modifiedAfter) {
    reasons.push({ key: "date-from", label: "显示起始日期早于扫描起始日期" });
  }
  if (scan.modifiedBefore > 0 && to > 0 && to > scan.modifiedBefore) {
    reasons.push({ key: "date-to", label: "显示结束日期晚于扫描结束日期" });
  }

  if (scan.skipHidden && !filter.skipHidden) {
    reasons.push({ key: "hidden", label: "扫描跳过了隐藏文件，显示要求展示" });
  }

  const scanKeyword = scan.excludeKeyword.trim().toLowerCase();
  if (scanKeyword) {
    const displayKeyword =
      filter.keywordMode === "exclude" ? filter.keyword.trim().toLowerCase() : "";
    if (!displayKeyword.includes(scanKeyword)) {
      reasons.push({ key: "keyword", label: "扫描排除了关键字，显示未排除" });
    }
  }

  return reasons;
}
