import { describe, expect, it } from "vitest";
import { MAX_DIR_PAIRS } from "./dir-pairs";
import { openDirPairsDb } from "./dir-pairs-db";
import type { FilterPrefs } from "./types";

function filters(overrides: Partial<FilterPrefs> = {}): FilterPrefs {
  return {
    sizeEnabled: false,
    sizeMin: 0,
    sizeMax: 0,
    sizeMinUnit: "MB",
    sizeMaxUnit: "MB",
    maxDepth: 0,
    includeInput: "",
    excludeInput: "",
    excludePathsInput: "",
    dateFrom: "",
    dateTo: "",
    recentDays: 0,
    skipHidden: true,
    ...overrides,
  };
}

describe("目录对档案库", () => {
  it("保存条件不动使用排序，扫描成功才置顶", () => {
    const store = openDirPairsDb(":memory:");
    store.save("A", "B", filters({ sizeMin: 100 }));
    expect(store.list()[0]).toMatchObject({ usedAt: null, filters: { sizeMin: 100 } });

    store.touch("C", "D");
    expect(store.list()[0].left).toBe("C");

    /* 左右互换命中同一组，条件保留，显示顺序保持首次写入 */
    store.touch("B", "A");
    expect(store.list()[0].left).toBe("A");
    expect(store.list()[0].filters).toMatchObject({ sizeMin: 100 });
    expect(store.list()).toHaveLength(2);
    expect(store.recent()).toHaveLength(2);
    store.close();
  });

  it("超过容量淘汰到上限", () => {
    const store = openDirPairsDb(":memory:");
    for (let i = 0; i < MAX_DIR_PAIRS + 5; i += 1) {
      store.touch(`L${i}`, `R${i}`);
    }
    expect(store.list()).toHaveLength(MAX_DIR_PAIRS);
    store.close();
  });

  it("搜索匹配左右路径，空关键词回落最近 10 组", () => {
    const store = openDirPairsDb(":memory:");
    store.touch("D:\\notes", "E:\\notes");
    store.touch("D:\\work", "E:\\work");
    expect(store.search("NOTES")).toHaveLength(1);
    expect(store.search("missing")).toHaveLength(0);
    expect(store.search("")).toHaveLength(2);
    store.close();
  });

  it("旧 recent-pairs 记录导入后可出现在最近列表", () => {
    const store = openDirPairsDb(":memory:");
    store.importLegacy([{ left: "L", right: "R", savedAt: "2026-01-01T00:00:00.000Z" }]);
    expect(store.recent()[0]).toMatchObject({
      left: "L",
      right: "R",
      usedAt: "2026-01-01T00:00:00.000Z",
      filters: null,
    });
    store.close();
  });

  it("同组合重复写入不产生重复条目", () => {
    const store = openDirPairsDb(":memory:");
    store.touch("A", "B");
    store.touch("b", "a");
    expect(store.list()).toHaveLength(1);
    store.close();
  });

  it("删除后档案里不再出现", () => {
    const store = openDirPairsDb(":memory:");
    store.touch("A", "B");
    store.touch("C", "D");
    store.remove("A", "B");
    expect(store.list().some((item) => item.left === "A")).toBe(false);
    expect(store.list()).toHaveLength(1);
    store.close();
  });
});
