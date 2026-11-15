import { describe, expect, it } from "vitest";
import { formatEta } from "./format";

describe("formatEta", () => {
  it("按量级取整，避免秒级跳动", () => {
    expect(formatEta(3)).toBe("剩余约 3 秒");
    expect(formatEta(27)).toBe("剩余约 25 秒");
    expect(formatEta(180)).toBe("剩余约 3 分钟");
    expect(formatEta(900)).toBe("剩余超过 10 分钟");
  });

  it("样本不足或已完成时不显示", () => {
    expect(formatEta(null)).toBeNull();
    expect(formatEta(undefined)).toBeNull();
    expect(formatEta(0)).toBeNull();
  });
});
