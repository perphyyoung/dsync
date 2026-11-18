import { describe, expect, it } from "vitest";
import { sortItems } from "./sort";
import type { DiffRow } from "./types";

function row(overrides: Partial<DiffRow>): DiffRow {
  return {
    status: "left-only",
    left: null,
    right: null,
    leftSize: null,
    rightSize: null,
    leftDate: null,
    rightDate: null,
    leftHash: null,
    rightHash: null,
    base: null,
    pairedBy: null,
    note: null,
    ...overrides,
  };
}

describe("列排序", () => {
  it("路径忽略大小写，空侧取另一侧", () => {
    const items = [
      { row: row({ left: "b.md" }), index: 0 },
      { row: row({ right: "A.md" }), index: 1 },
      { row: row({ left: "c.md" }), index: 2 },
    ];
    expect(sortItems(items, "path", "asc").map((item) => item.index)).toEqual([1, 0, 2]);
    expect(sortItems(items, "path", "desc").map((item) => item.index)).toEqual([2, 0, 1]);
  });

  it("日期与大小按数值，空值无论升降序都排末尾", () => {
    const items = [
      { row: row({ leftDate: 300, leftSize: 3 }), index: 0 },
      { row: row({ leftDate: null, leftSize: null }), index: 1 },
      { row: row({ leftDate: 100, leftSize: 1 }), index: 2 },
    ];
    expect(sortItems(items, "date", "asc").map((item) => item.index)).toEqual([2, 0, 1]);
    expect(sortItems(items, "date", "desc").map((item) => item.index)).toEqual([0, 2, 1]);
    expect(sortItems(items, "size", "asc").map((item) => item.index)).toEqual([2, 0, 1]);
    expect(sortItems(items, "size", "desc").map((item) => item.index)).toEqual([0, 2, 1]);
  });
});
