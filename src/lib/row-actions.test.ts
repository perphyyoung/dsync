import { describe, expect, it } from "vitest";
import { rowDirections } from "./row-actions";
import type { DiffRow } from "./types";

function makeRow(overrides: Partial<DiffRow>): DiffRow {
  return {
    status: "diff",
    left: null,
    right: null,
    leftSize: 1,
    rightSize: 1,
    leftHash: "h1",
    rightHash: "h2",
    base: null,
    pairedBy: null,
    note: null,
    ...overrides,
  };
}

describe("单行方向", () => {
  it("两侧都有且内容不同：两个方向都是复制，不涉及删除", () => {
    const dirs = rowDirections(makeRow({ left: "a.md", right: "a.md" }), 0);
    expect(dirs.right.actions[0]).toMatchObject({ kind: "copy", side: "right" });
    expect(dirs.left.actions[0]).toMatchObject({ kind: "copy", side: "left" });
    expect(dirs.right.deletes).toBe(false);
    expect(dirs.left.deletes).toBe(false);
  });

  it("仅左侧存在：向右是复制，向左等于删除左侧", () => {
    const dirs = rowDirections(makeRow({ status: "left-only", left: "a.md" }), 2);
    expect(dirs.right.actions[0]).toMatchObject({ kind: "copy", side: "right" });
    expect(dirs.right.deletes).toBe(false);
    expect(dirs.left.actions[0]).toMatchObject({
      kind: "delete",
      side: "left",
      toPath: "a.md",
      rowIndex: 2,
    });
    expect(dirs.left.deletes).toBe(true);
  });

  it("仅右侧存在：向左是复制，向右等于删除右侧", () => {
    const dirs = rowDirections(makeRow({ status: "right-only", right: "b.md" }), 0);
    expect(dirs.left.actions[0]).toMatchObject({ kind: "copy", side: "left" });
    expect(dirs.right.actions[0]).toMatchObject({ kind: "delete", side: "right", toPath: "b.md" });
    expect(dirs.right.deletes).toBe(true);
  });

  it("路径不同的差异：改写会顺带清掉旧路径，算删除", () => {
    const dirs = rowDirections(makeRow({ left: "a.md", right: "old.md" }), 1);
    expect(dirs.right.actions.map((action) => action.kind)).toEqual(["copy", "delete"]);
    expect(dirs.right.deletes).toBe(true);
    expect(dirs.left.actions.map((action) => action.kind)).toEqual(["copy", "delete"]);
  });

  it("moved 行两个方向都是改名", () => {
    const dirs = rowDirections(makeRow({ status: "moved", left: "deep/a.md", right: "a.md" }), 0);
    expect(dirs.left.actions[0]).toMatchObject({ kind: "move", side: "left", toPath: "a.md" });
    expect(dirs.right.actions[0]).toMatchObject({
      kind: "move",
      side: "right",
      toPath: "deep/a.md",
    });
    expect(dirs.left.deletes).toBe(false);
  });

  it("一致、忽略、目标占用的行没有动作", () => {
    const same = rowDirections(makeRow({ status: "same", left: "a.md", right: "a.md" }), 0);
    expect(same.left.actions).toEqual([]);
    expect(same.right.actions).toEqual([]);

    const ignored = rowDirections(makeRow({ status: "ignored", left: "a.log", right: "a.log" }), 0);
    expect(ignored.left.actions).toEqual([]);
    expect(ignored.right.actions).toEqual([]);

    const blocked = rowDirections(
      makeRow({ status: "target-blocked", left: "a.md", right: "b.md" }),
      0,
    );
    expect(blocked.left.actions).toEqual([]);
    expect(blocked.right.actions).toEqual([]);
  });
});
