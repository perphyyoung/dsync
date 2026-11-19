import { describe, expect, it } from "vitest";
import { directResults } from "./execute-result";
import type { DiffRow, SyncAction } from "./types";

function row(overrides: Partial<DiffRow> = {}): DiffRow {
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

const copy: SyncAction = {
  kind: "copy",
  side: "left",
  fromPath: "a.md",
  toPath: "a.md",
  status: "right-only",
  rowIndex: 0,
  sourceHash: "h1",
  sizeBytes: 3,
};

describe("执行成功后的行状态", () => {
  it("copy 直接用源哈希和大小，不再读目标", () => {
    const source = row({
      status: "right-only",
      right: "a.md",
      rightSize: 3,
      rightDate: 100,
      rightHash: "h1",
    });
    const result = directResults([source], [copy], 200);
    expect(result.fallback).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      rowIndex: 0,
      left: { path: "a.md", hash: "h1", size: 3, mtimeMs: 200 },
      right: { hash: "h1", size: 3, mtimeMs: 100 },
    });
  });

  it("move 只改路径，哈希和日期沿用", () => {
    const source = row({
      status: "moved",
      left: "old.md",
      leftSize: 3,
      leftDate: 100,
      leftHash: "h1",
      right: "new.md",
      rightSize: 3,
      rightDate: 100,
      rightHash: "h1",
    });
    const action: SyncAction = {
      kind: "move",
      side: "left",
      fromPath: "old.md",
      toPath: "new.md",
      status: "moved",
      rowIndex: 0,
    };
    const result = directResults([source], [action]);
    expect(result.fallback).toEqual([]);
    expect(result.rows[0].left).toMatchObject({ path: "new.md", hash: "h1", mtimeMs: 100 });
  });

  it("soft-delete 只清对应侧", () => {
    const source = row({
      left: "a.md",
      leftSize: 3,
      leftDate: 100,
      leftHash: "h1",
    });
    const action: SyncAction = {
      kind: "soft-delete",
      side: "left",
      fromPath: null,
      toPath: "a.md",
      status: "left-only",
      rowIndex: 0,
    };
    const result = directResults([source], [action]);
    expect(result.rows[0]).toMatchObject({ left: null, right: null });
  });

  it("缺少可信哈希时整行回退刷新", () => {
    const source = row({ right: "a.md", rightSize: 3, rightHash: null });
    const result = directResults([source], [{ ...copy, sourceHash: null }]);
    expect(result.rows).toEqual([]);
    expect(result.fallback).toEqual([{ ...copy, sourceHash: null }]);
  });
});
