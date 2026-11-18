import { describe, expect, it } from "vitest";
import { mirrorScanResult } from "./mirror";
import type { DiffRow, ScanResult } from "./types";

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

function result(rows: DiffRow[]): ScanResult {
  return {
    rows,
    stats: {
      same: 0,
      moved: 1,
      duplicateLeft: 2,
      duplicateRight: 3,
      leftOnly: 4,
      rightOnly: 5,
      ignored: 6,
      targetBlocked: 7,
    },
    warnings: ["索引损坏"],
  };
}

describe("互换后的结果镜像", () => {
  it("单侧状态与路径左右对调，行号不变", () => {
    const mirrored = mirrorScanResult(
      result([
        row({ status: "left-only", left: "a.md", leftSize: 10, leftDate: 100, leftHash: "h1" }),
        row({
          status: "right-only",
          right: "b.md",
          rightSize: 20,
          rightDate: 200,
          rightHash: "h2",
        }),
      ]),
    );
    expect(mirrored.rows[0]).toMatchObject({
      status: "right-only",
      left: null,
      right: "a.md",
      rightSize: 10,
      rightDate: 100,
      rightHash: "h1",
    });
    expect(mirrored.rows[1]).toMatchObject({
      status: "left-only",
      left: "b.md",
      leftSize: 20,
      leftDate: 200,
      leftHash: "h2",
    });
  });

  it("moved 行路径对调但状态不变", () => {
    const mirrored = mirrorScanResult(
      result([
        row({ status: "moved", left: "c.md", right: "deep/c.md", leftHash: "h", rightHash: "h" }),
      ]),
    );
    expect(mirrored.rows[0]).toMatchObject({
      status: "moved",
      left: "deep/c.md",
      right: "c.md",
    });
  });

  it("统计的单侧计数对调，其余与 warnings 保留", () => {
    const mirrored = mirrorScanResult(result([]));
    expect(mirrored.stats).toEqual({
      same: 0,
      moved: 1,
      duplicateLeft: 3,
      duplicateRight: 2,
      leftOnly: 5,
      rightOnly: 4,
      ignored: 6,
      targetBlocked: 7,
    });
    expect(mirrored.warnings).toEqual(["索引损坏"]);
  });
});
