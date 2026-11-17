import { describe, expect, it } from "vitest";
import { pairKey } from "./dir-pairs";

describe("目录对键", () => {
  it("与左右顺序、大小写无关", () => {
    expect(pairKey("D:\\a", "D:\\b")).toBe(pairKey("d:\\B", "d:\\A"));
    expect(pairKey("D:\\a", "D:\\b")).not.toBe(pairKey("D:\\a", "D:\\c"));
  });
});
