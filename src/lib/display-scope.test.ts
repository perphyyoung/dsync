import { describe, expect, it } from "vitest";
import type { DisplayFilter } from "./display-filter";
import { findWiderReasons, type ScanScope } from "./display-scope";

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

function scan(overrides: Partial<ScanScope> = {}): ScanScope {
  return {
    minSize: 0,
    maxSize: 0,
    modifiedAfter: 0,
    modifiedBefore: 0,
    skipHidden: false,
    excludeKeyword: "",
    ...overrides,
  };
}

describe("显示范围是否超出扫描范围", () => {
  it("空条件与缩小都不算扩大", () => {
    expect(findWiderReasons(filter(), scan())).toEqual([]);
    expect(findWiderReasons(filter({ sizeMin: 100 }), scan({ minSize: 50 }))).toEqual([]);
    expect(
      findWiderReasons(filter({ sizeMin: 100, sizeMax: 200 }), scan({ minSize: 50, maxSize: 500 })),
    ).toEqual([]);
  });

  it("大小超出扫描上下限", () => {
    expect(findWiderReasons(filter({ sizeMin: 10 }), scan({ minSize: 50 }))).toMatchObject([
      { key: "size-min" },
    ]);
    expect(findWiderReasons(filter({ sizeMax: 600 }), scan({ maxSize: 500 }))).toMatchObject([
      { key: "size-max" },
    ]);
  });

  it("日期超出扫描范围", () => {
    const after = new Date("2026-11-10T00:00:00").getTime();
    const before = new Date("2026-11-20T23:59:59.999").getTime();
    expect(
      findWiderReasons(filter({ dateFrom: "2026-11-01" }), scan({ modifiedAfter: after })),
    ).toMatchObject([{ key: "date-from" }]);
    expect(
      findWiderReasons(filter({ dateTo: "2026-11-30" }), scan({ modifiedBefore: before })),
    ).toMatchObject([{ key: "date-to" }]);
  });

  it("扫描跳过隐藏但显示要求展示", () => {
    expect(
      findWiderReasons(filter({ skipHidden: false }), scan({ skipHidden: true })),
    ).toMatchObject([{ key: "hidden" }]);
    expect(findWiderReasons(filter({ skipHidden: true }), scan({ skipHidden: true }))).toEqual([]);
  });

  it("扫描排除了关键字而显示未排除", () => {
    expect(
      findWiderReasons(
        filter({ keywordMode: "include" }),
        scan({ excludeKeyword: "node_modules" }),
      ),
    ).toMatchObject([{ key: "keyword" }]);
    expect(
      findWiderReasons(
        filter({ keywordMode: "exclude", keyword: "node_modules" }),
        scan({ excludeKeyword: "node_modules" }),
      ),
    ).toEqual([]);
    expect(
      findWiderReasons(
        filter({ keywordMode: "exclude", keyword: "other" }),
        scan({ excludeKeyword: "node_modules" }),
      ),
    ).toMatchObject([{ key: "keyword" }]);
  });
});
