import { describe, expect, it } from "vitest";
import { etaHint, formatEta } from "./format";

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
