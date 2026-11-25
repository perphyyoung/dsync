import { describe, expect, it } from "vitest";
import { evaluateDiskChange } from "./disk-change";

describe("evaluateDiskChange", () => {
  it("快照缺失时回填，不视为变化", () => {
    expect(evaluateDiskChange(null, { left: "ssd", right: "hdd" })).toEqual({
      changed: false,
      reason: "filled",
    });
    expect(evaluateDiskChange(undefined, { left: "unknown", right: "unknown" })).toEqual({
      changed: false,
      reason: "filled",
    });
  });

  it("盘型一致时不变化", () => {
    expect(
      evaluateDiskChange({ left: "ssd", right: "ssd" }, { left: "ssd", right: "ssd" }),
    ).toEqual({ changed: false });
    expect(
      evaluateDiskChange({ left: "hdd", right: "unknown" }, { left: "hdd", right: "unknown" }),
    ).toEqual({ changed: false });
  });

  it("任一侧变化都算变化", () => {
    expect(
      evaluateDiskChange({ left: "ssd", right: "ssd" }, { left: "hdd", right: "ssd" }).changed,
    ).toBe(true);
    expect(
      evaluateDiskChange({ left: "ssd", right: "ssd" }, { left: "ssd", right: "unknown" }).changed,
    ).toBe(true);
    expect(
      evaluateDiskChange({ left: "hdd", right: "hdd" }, { left: "ssd", right: "ssd" }).changed,
    ).toBe(true);
  });
});
