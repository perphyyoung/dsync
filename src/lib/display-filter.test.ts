import { describe, expect, it } from "vitest";
import { matchesDisplayFilter, type DisplayFilter } from "./display-filter";
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

function filter(overrides: Partial<DisplayFilter> = {}): DisplayFilter {
  return {
    keywordMode: "include",
    keyword: "",
    suffixMode: "include",
    suffixes: [],
    dateFrom: "",
    dateTo: "",
    sizeMin: 0,
    sizeMax: 0,
    depth: 0,
    skipHidden: false,
    ...overrides,
  };
}

describe("显示过滤", () => {
  it("空条件全部通过", () => {
    const item = row({ left: "docs/a.md", leftSize: 10, leftDate: 1000 });
    expect(matchesDisplayFilter(item, filter())).toBe(true);
  });

  it("关键字：任一侧路径或文件名包含才命中/命中即排除", () => {
    const item = row({ left: "docs/readme.md", right: "docs/readme2.md" });
    expect(matchesDisplayFilter(item, filter({ keyword: "readme" }))).toBe(true);
    expect(matchesDisplayFilter(item, filter({ keyword: "photo" }))).toBe(false);
    expect(matchesDisplayFilter(item, filter({ keywordMode: "exclude", keyword: "readme" }))).toBe(
      false,
    );
  });

  it("后缀：只含 / 排除，任一侧命中", () => {
    const item = row({ left: "a.md", right: "a.txt" });
    expect(matchesDisplayFilter(item, filter({ suffixes: [".md"] }))).toBe(true);
    expect(matchesDisplayFilter(item, filter({ suffixes: [".log"] }))).toBe(false);
    expect(matchesDisplayFilter(item, filter({ suffixMode: "exclude", suffixes: [".md"] }))).toBe(
      false,
    );
  });

  it("日期与大小：任一侧落在范围内", () => {
    const item = row({ left: "a.md", leftSize: 100, leftDate: new Date(2026, 10, 10).getTime() });
    expect(
      matchesDisplayFilter(item, filter({ dateFrom: "2026-11-01", dateTo: "2026-11-15" })),
    ).toBe(true);
    expect(matchesDisplayFilter(item, filter({ dateFrom: "2026-11-11" }))).toBe(false);
    expect(matchesDisplayFilter(item, filter({ sizeMin: 50, sizeMax: 200 }))).toBe(true);
    expect(matchesDisplayFilter(item, filter({ sizeMin: 200 }))).toBe(false);
  });

  it("层级与隐藏文件", () => {
    const deep = row({ left: "one/two/three.md" });
    expect(matchesDisplayFilter(deep, filter({ depth: 2 }))).toBe(false);
    expect(matchesDisplayFilter(deep, filter({ depth: 3 }))).toBe(true);

    const hidden = row({ left: "docs/.cache/a.md" });
    expect(matchesDisplayFilter(hidden, filter({ skipHidden: true }))).toBe(false);
    expect(matchesDisplayFilter(hidden, filter({ skipHidden: false }))).toBe(true);
  });
});
