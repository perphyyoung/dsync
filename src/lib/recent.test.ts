import { describe, expect, it } from "vitest";
import { MAX_RECENT_PAIRS, mergeRecentPair, parseRecentPairs } from "./recent";
import type { RecentPair } from "./types";

describe("最近目录对", () => {
  it("新的排最前", () => {
    const list = mergeRecentPair([], { left: "D:\\a", right: "E:\\b" }, "t1");
    const next = mergeRecentPair(list, { left: "D:\\c", right: "E:\\d" }, "t2");
    expect(next.map((item) => item.left)).toEqual(["D:\\c", "D:\\a"]);
  });

  it("同一组重复加载只保留一条并提到最前", () => {
    let list = mergeRecentPair([], { left: "D:\\a", right: "E:\\b" }, "t1");
    list = mergeRecentPair(list, { left: "D:\\c", right: "E:\\d" }, "t2");
    list = mergeRecentPair(list, { left: "d:\\A", right: "e:\\B" }, "t3");
    expect(list).toHaveLength(2);
    expect(list[0]?.left).toBe("d:\\A");
  });

  it(`最多保留 ${MAX_RECENT_PAIRS} 组`, () => {
    let list: RecentPair[] = [];
    for (let index = 0; index < MAX_RECENT_PAIRS + 5; index += 1) {
      list = mergeRecentPair(list, { left: `D:\\l${index}`, right: `E:\\r${index}` }, `t${index}`);
    }
    expect(list).toHaveLength(MAX_RECENT_PAIRS);
    expect(list[0]?.left).toBe(`D:\\l${MAX_RECENT_PAIRS + 4}`);
  });

  it("空目录对不写入", () => {
    expect(mergeRecentPair([], { left: "", right: "E:\\b" })).toEqual([]);
  });

  it("坏数据一律当空列表", () => {
    expect(parseRecentPairs("not json")).toEqual([]);
    expect(parseRecentPairs("{}")).toEqual([]);
    expect(parseRecentPairs(JSON.stringify([{ left: "D:\\a" }]))).toEqual([]);
  });
});
