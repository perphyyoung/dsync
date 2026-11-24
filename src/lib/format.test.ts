import { describe, expect, it } from "vitest";
import {
  describeAction,
  etaHint,
  formatDate,
  formatDuration,
  formatEta,
  formatSize,
} from "./format";
import type { SyncAction } from "./types";

describe("formatSize", () => {
  it("按 1024 逐级换算，非字节单位统一两位小数", () => {
    expect(formatSize(1023)).toBe("1023 B");
    expect(formatSize(1024)).toBe("1.00 KB");
    expect(formatSize(1536)).toBe("1.50 KB");
    expect(formatSize(1024 * 1024)).toBe("1.00 MB");
    expect(formatSize(2.5 * 1024 * 1024)).toBe("2.50 MB");
    expect(formatSize(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatSize(4973.1 * 1024 * 1024)).toBe("4.86 GB");
  });

  it("空值返回空字符串", () => {
    expect(formatSize(null)).toBe("");
  });
});

describe("formatDuration", () => {
  it("不足 1 分钟保留 1 位小数", () => {
    expect(formatDuration(0)).toBe("0.0 秒");
    expect(formatDuration(999)).toBe("1.0 秒");
    expect(formatDuration(12_300)).toBe("12.3 秒");
    expect(formatDuration(59_400)).toBe("59.4 秒");
  });

  it("满 1 分钟按分钟取整", () => {
    expect(formatDuration(60_000)).toBe("1 分");
    expect(formatDuration(65_000)).toBe("1 分 5 秒");
    expect(formatDuration(3_600_000)).toBe("60 分");
  });
});

describe("formatDate", () => {
  it("只显示到天，月日补零", () => {
    expect(formatDate(new Date(2026, 10, 8, 23, 59).getTime())).toBe("2026-11-08");
    expect(formatDate(new Date(2026, 0, 1, 0, 0).getTime())).toBe("2026-01-01");
  });

  it("空值返回空字符串", () => {
    expect(formatDate(null)).toBe("");
  });
});

describe("formatEta", () => {
  it("按量级取整，避免秒级跳动", () => {
    expect(formatEta(3)).toBe("剩余约 3 秒");
    expect(formatEta(27)).toBe("剩余约 25 秒");
  });

  it("分钟级不封顶", () => {
    expect(formatEta(61)).toBe("剩余约 1 分钟");
    expect(formatEta(180)).toBe("剩余约 3 分钟");
    expect(formatEta(600)).toBe("剩余约 10 分钟");
    expect(formatEta(1800)).toBe("剩余约 30 分钟");
  });

  it("小时级按 5 分钟取整", () => {
    expect(formatEta(3599)).toBe("剩余约 1 小时");
    expect(formatEta(4500)).toBe("剩余约 1 小时 15 分钟");
    expect(formatEta(7200)).toBe("剩余约 2 小时");
  });

  it("样本不足或已完成时不显示", () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(undefined)).toBeNull();
    expect(formatEta(0)).toBeNull();
  });
});

describe("etaHint", () => {
  it("低于 5 分钟不提示", () => {
    expect(etaHint(299)).toBeNull();
    expect(etaHint(null)).toBeNull();
  });

  it("满 5 分钟提示可缩小范围", () => {
    expect(etaHint(300)).toEqual({
      text: "耗时较长，可用过滤条件缩小范围，或随时暂停",
      level: "tip",
    });
    expect(etaHint(3599)?.level).toBe("tip");
  });

  it("满 1 小时建议取消后分批", () => {
    const hint = etaHint(3600);
    expect(hint?.level).toBe("strong");
    expect(hint?.text).toContain("建议先取消");
    expect(etaHint(36000)?.level).toBe("strong");
  });
});

describe("describeAction", () => {
  const base: SyncAction = {
    kind: "copy",
    side: "right",
    fromPath: "a.md",
    toPath: "a.md",
    status: "left-only",
    rowIndex: 0,
  };

  it("同路径复制只写一次文件名", () => {
    expect(describeAction(base)).toBe("复制 a.md");
  });

  it("复制到不同路径时显示 from → to", () => {
    expect(describeAction({ ...base, toPath: "b.md" })).toBe("复制 a.md → b.md");
  });

  it("改名显示 from → to，软删除只写目标路径", () => {
    expect(describeAction({ ...base, kind: "move", toPath: "b.md" })).toBe("改名 a.md → b.md");
    expect(describeAction({ ...base, kind: "soft-delete", fromPath: null })).toBe("软删除 a.md");
  });
});
