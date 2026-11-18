import { describe, expect, it } from "vitest";
import { resolveTimeWindow } from "./time-window";

/* 固定本地时间，避免时区与时钟抖动 */
const now = new Date(2026, 10, 18, 15, 30);

describe("修改日期窗口", () => {
  it("最近 N 天按自然日：含今天共 N 天", () => {
    const one = resolveTimeWindow({ mode: "recent", recentDays: 1, dateFrom: "", dateTo: "" }, now);
    expect(one.modifiedAfter).toBe(new Date(2026, 10, 18).getTime());

    const seven = resolveTimeWindow(
      { mode: "recent", recentDays: 7, dateFrom: "", dateTo: "" },
      now,
    );
    expect(seven.modifiedAfter).toBe(new Date(2026, 10, 12).getTime());
    expect(seven.modifiedBefore).toBe(0);
  });

  it("最近天数下限为 1", () => {
    const window = resolveTimeWindow(
      { mode: "recent", recentDays: 0, dateFrom: "", dateTo: "" },
      now,
    );
    expect(window.modifiedAfter).toBe(new Date(2026, 10, 18).getTime());
  });

  it("自定义取起止日期的首尾毫秒", () => {
    const window = resolveTimeWindow(
      { mode: "custom", recentDays: 7, dateFrom: "2026-11-01", dateTo: "2026-11-15" },
      now,
    );
    expect(window.modifiedAfter).toBe(new Date("2026-11-01T00:00:00").getTime());
    expect(window.modifiedBefore).toBe(new Date("2026-11-15T23:59:59.999").getTime());
  });

  it("不限返回 0", () => {
    const window = resolveTimeWindow(
      { mode: "none", recentDays: 7, dateFrom: "2026-11-01", dateTo: "2026-11-15" },
      now,
    );
    expect(window).toEqual({ modifiedAfter: 0, modifiedBefore: 0 });
  });
});
