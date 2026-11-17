import { describe, expect, it } from "vitest";
import { buildPreview, previewKindRows } from "./preview";
import type { DiffRow } from "./types";

function makeRow(overrides: Partial<DiffRow>): DiffRow {
  return {
    status: "left-only",
    left: null,
    right: null,
    leftSize: 1,
    rightSize: 1,
    leftHash: "h1",
    rightHash: null,
    base: null,
    pairedBy: null,
    note: null,
    ...overrides,
  };
}

describe("预览统计", () => {
  it("按动作类型分别计数", () => {
    const rows = [
      makeRow({ status: "left-only", left: "a.md" }),
      makeRow({ status: "right-only", right: "b.md" }),
      makeRow({ status: "moved", left: "c.md", right: "deep/c.md" }),
    ];
    const preview = buildPreview(rows, new Set([0, 1, 2]), "left");
    expect(preview.stats).toMatchObject({ softDelete: 1, copy: 1, rename: 1, ignored: 0 });
    expect(preview.actions).toHaveLength(3);
  });

  it("勾选的一致、重复、目标占用算忽略", () => {
    const rows = [
      makeRow({ status: "left-only", left: "a.md" }),
      makeRow({ status: "same", left: "b.md", right: "b.md" }),
      makeRow({ status: "duplicate", left: "c.md" }),
      makeRow({ status: "target-blocked", left: "d.md", right: "d.md" }),
    ];
    const preview = buildPreview(rows, new Set([1, 2, 3]), "left");
    expect(preview.stats.ignored).toBe(3);
    expect(preview.actions).toHaveLength(0);
  });

  it("重排目标被其他行占用时跳过", () => {
    const rows = [
      makeRow({ status: "moved", left: "a.md", right: "b.md" }),
      makeRow({ status: "left-only", left: "b.md" }),
    ];
    const preview = buildPreview(rows, new Set([0, 1]), "left");
    // 第一行想把 a.md 移到 b.md，但 b.md 属于第二行；第二行本身照常软删除
    expect(preview.stats.rename).toBe(0);
    expect(preview.stats.ignored).toBe(1);
    expect(preview.stats.softDelete).toBe(1);
  });

  it("以右为准时反过来算", () => {
    const rows = [
      makeRow({ status: "left-only", left: "a.md" }),
      makeRow({ status: "right-only", right: "b.md" }),
    ];
    const preview = buildPreview(rows, new Set([0, 1]), "right");
    expect(preview.stats).toMatchObject({ copy: 1, softDelete: 1 });
  });

  it("按动作类型聚合涉及的行号", () => {
    const rows = [
      makeRow({ status: "left-only", left: "a.md" }),
      makeRow({ status: "right-only", right: "b.md" }),
      makeRow({ status: "moved", left: "c.md", right: "deep/c.md" }),
      makeRow({ status: "same", left: "d.md", right: "d.md" }),
    ];
    const groups = previewKindRows(rows, "left");
    expect(groups.softDelete).toEqual([0]);
    expect(groups.copy).toEqual([1]);
    expect(groups.rename).toEqual([2]);
    /* 一致行不参与任何动作 */
    expect(groups.copy).not.toContain(3);
  });

  it("重排目标被占用时不归入改名列", () => {
    const rows = [
      makeRow({ status: "moved", left: "a.md", right: "b.md" }),
      makeRow({ status: "left-only", left: "b.md" }),
    ];
    const groups = previewKindRows(rows, "left");
    expect(groups.rename).toEqual([]);
    expect(groups.softDelete).toEqual([1]);
  });
});
