import type { TimeMode } from "./types";

export interface TimeWindowInput {
  mode: TimeMode;
  recentDays: number;
  dateFrom: string;
  dateTo: string;
}

export interface TimeWindow {
  modifiedAfter: number;
  modifiedBefore: number;
}

/**
 * 修改日期窗口：按自然日计算，不精确到时分秒。
 * recent：含今天在内的 N 个自然日；custom：起止日期的首尾毫秒；none：不限。
 */
export function resolveTimeWindow(input: TimeWindowInput, now = new Date()): TimeWindow {
  if (input.mode === "recent") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Math.max(1, Math.floor(input.recentDays)) - 1));
    return { modifiedAfter: start.getTime(), modifiedBefore: 0 };
  }
  if (input.mode === "custom") {
    const fromDate = input.dateFrom ? new Date(`${input.dateFrom}T00:00:00`).getTime() : 0;
    const toDate = input.dateTo ? new Date(`${input.dateTo}T23:59:59.999`).getTime() : 0;
    return { modifiedAfter: fromDate, modifiedBefore: toDate };
  }
  return { modifiedAfter: 0, modifiedBefore: 0 };
}
