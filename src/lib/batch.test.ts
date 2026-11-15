import { describe, expect, it } from "vitest";
import { computeBatchStats, detectTargetConflicts } from "./batch";
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

describe("批量统计", () => {
  it("以左为准时，右侧的新增 / 修改 / 删除分别计数", () => {
    const rows = [
      makeRow({ status: "diff", left: "a.md", right: "a.md" }),
      makeRow({ status: "left-only", left: "b.md" }),
      makeRow({ status: "right-only", right: "c.md" }),
    ];
    const stats = computeBatchStats(rows, new Set([0, 1, 2]), "right", false);
    expect(stats).toEqual({ rows: 3, added: 1, modified: 1, deleted: 1, blocked: 0 });
  });

  it("以右为准时改算左侧", () => {
    const rows = [
      makeRow({ status: "diff", left: "a.md", right: "a.md" }),
      makeRow({ status: "left-only", left: "b.md" }),
      makeRow({ status: "right-only", right: "c.md" }),
    ];
    const stats = computeBatchStats(rows, new Set([0, 1, 2]), "left", false);
    expect(stats).toEqual({ rows: 3, added: 1, modified: 1, deleted: 1, blocked: 0 });
  });

  it("moved 行只有重排路径时才算修改", () => {
    const rows = [makeRow({ status: "moved", left: "deep/a.md", right: "a.md" })];
    expect(computeBatchStats(rows, new Set([0]), "right", false).rows).toBe(0);
    expect(computeBatchStats(rows, new Set([0]), "right", true)).toMatchObject({
      rows: 1,
      modified: 1,
    });
  });

  it("一致与忽略的行不计入", () => {
    const rows = [
      makeRow({ status: "same", left: "a.md", right: "a.md" }),
      makeRow({ status: "ignored", left: "b.log", right: "b.log" }),
    ];
    expect(computeBatchStats(rows, new Set([0, 1]), "right", false).rows).toBe(0);
  });

  it("只统计选中的行", () => {
    const rows = [
      makeRow({ status: "diff", left: "a.md", right: "a.md" }),
      makeRow({ status: "diff", left: "b.md", right: "b.md" }),
    ];
    expect(computeBatchStats(rows, new Set([1]), "right", false)).toMatchObject({
      rows: 1,
      modified: 1,
    });
  });
});

describe("目标路径冲突", () => {
  it("重排时目标路径被别的行占住", () => {
    const rows = [
      makeRow({ status: "moved", left: "a.md", right: "b.md" }),
      makeRow({ status: "moved", left: "c.md", right: "a.md" }),
    ];
    const conflicts = detectTargetConflicts(rows, new Set([0, 1]), "right");
    expect(conflicts.has(0)).toBe(true);
    expect(conflicts.has(1)).toBe(false);
  });

  it("原地覆盖不算冲突", () => {
    const rows = [makeRow({ status: "diff", left: "a.md", right: "a.md" })];
    expect(detectTargetConflicts(rows, new Set([0]), "right").size).toBe(0);
  });

  it("目标侧没有该路径时不算冲突", () => {
    const rows = [makeRow({ status: "left-only", left: "a.md" })];
    expect(detectTargetConflicts(rows, new Set([0]), "right").size).toBe(0);
  });

  it("冲突行会被排除出统计", () => {
    const rows = [
      makeRow({ status: "moved", left: "a.md", right: "b.md" }),
      makeRow({ status: "moved", left: "c.md", right: "a.md" }),
    ];
    const stats = computeBatchStats(rows, new Set([0, 1]), "right", true);
    expect(stats.blocked).toBe(1);
    expect(stats.rows).toBe(1);
  });
});
