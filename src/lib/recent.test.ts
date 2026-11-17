import { describe, expect, it } from "vitest";
import { parseRecentPairs } from "./recent";

describe("旧最近目录对解析（迁移用）", () => {
  it("坏数据一律当空列表", () => {
    expect(parseRecentPairs("not json")).toEqual([]);
    expect(parseRecentPairs("{}")).toEqual([]);
    expect(parseRecentPairs(JSON.stringify([{ left: "D:\\a" }]))).toEqual([]);
  });

  it("解析合法旧记录", () => {
    const list = parseRecentPairs(
      JSON.stringify([{ left: "D:\\a", right: "E:\\b", savedAt: "t1" }]),
    );
    expect(list).toEqual([{ left: "D:\\a", right: "E:\\b", savedAt: "t1" }]);
  });
});
