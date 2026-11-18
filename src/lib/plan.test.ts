import { describe, expect, it } from "vitest";
import { actionForRow, planSync, type PlanInput } from "./plan";
import { collection, entry } from "./test-helpers";
import type { DiffRow, PairRecord } from "./types";

function pair(left: string, right: string, base: string | null = "h1"): PairRecord {
  return {
    left,
    right,
    base,
    leftCache: null,
    rightCache: null,
    pairedBy: "path",
    syncedAt: null,
  };
}

function makeInput(overrides: Partial<PlanInput>): PlanInput {
  return {
    pairs: [],
    left: new Map(),
    right: new Map(),
    leftOnly: [],
    rightOnly: [],
    leftIgnored: [],
    rightIgnored: [],
    ...overrides,
  };
}

function makeRow(overrides: Partial<DiffRow>): DiffRow {
  return {
    status: "target-blocked",
    left: null,
    right: null,
    leftSize: 1,
    rightSize: 1,
    leftDate: null,
    rightDate: null,
    leftHash: "h1",
    rightHash: "h2",
    base: null,
    pairedBy: null,
    note: null,
    ...overrides,
  };
}

describe("差异行生成", () => {
  it("哈希与路径都相同 → 一致", () => {
    const outcome = planSync(
      makeInput({
        pairs: [pair("a.md", "a.md", "h1")],
        left: collection(entry("a.md", "h1")),
        right: collection(entry("a.md", "h1")),
      }),
    );
    expect(outcome.rows[0]?.status).toBe("same");
    expect(outcome.stats.same).toBe(1);
  });

  it("哈希相同、路径不同 → 仅路径不同", () => {
    const outcome = planSync(
      makeInput({
        pairs: [pair("deep/a.md", "a.md", "h1")],
        left: collection(entry("deep/a.md", "h1")),
        right: collection(entry("a.md", "h1")),
      }),
    );
    expect(outcome.rows[0]?.status).toBe("moved");
    expect(outcome.stats.moved).toBe(1);
  });

  it("同路径内容不同 → 目标占用", () => {
    const outcome = planSync(
      makeInput({
        leftOnly: ["a.md"],
        rightOnly: ["a.md"],
        left: collection(entry("a.md", "h2")),
        right: collection(entry("a.md", "h1")),
      }),
    );
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.status).toBe("target-blocked");
  });

  it("单侧文件分别标记", () => {
    const outcome = planSync(
      makeInput({
        leftOnly: ["x.md"],
        rightOnly: ["y.md"],
        left: collection(entry("x.md", "h1")),
        right: collection(entry("y.md", "h2")),
      }),
    );
    expect(outcome.stats.leftOnly).toBe(1);
    expect(outcome.stats.rightOnly).toBe(1);
  });

  it("忽略了特殊项时带上原因，且只在该侧显示", () => {
    const outcome = planSync(
      makeInput({
        leftIgnored: [{ path: "a.log", reason: "symlink", size: 10, mtimeMs: 1000 }],
      }),
    );
    expect(outcome.rows[0]).toMatchObject({
      status: "ignored",
      left: "a.log",
      right: null,
      leftDate: 1000,
      rightDate: null,
      note: "符号链接",
    });
    expect(outcome.stats.ignored).toBe(1);
  });

  it("两侧同路径都被忽略时合并为一行，日期与原因各自显示", () => {
    const outcome = planSync(
      makeInput({
        leftIgnored: [{ path: "a.log", reason: "symlink", size: 10, mtimeMs: 1000 }],
        rightIgnored: [{ path: "a.log", reason: "unreadable", size: 20, mtimeMs: 2000 }],
      }),
    );
    expect(outcome.rows[0]).toMatchObject({
      status: "ignored",
      left: "a.log",
      right: "a.log",
      leftSize: 10,
      rightSize: 20,
      leftDate: 1000,
      rightDate: 2000,
      note: "左：符号链接；右：读取失败",
    });
  });
});

describe("单行动作", () => {
  it("以左为准时把右侧路径改成左侧路径", () => {
    const actions = actionForRow(
      makeRow({ status: "moved", left: "a.md", right: "deep/a.md" }),
      "right",
      3,
      "align-left",
    );
    expect(actions).toEqual([
      {
        kind: "move",
        side: "right",
        fromPath: "deep/a.md",
        toPath: "a.md",
        status: "moved",
        rowIndex: 3,
      },
    ]);
  });

  it("以右为准时把左侧路径改成右侧路径", () => {
    const actions = actionForRow(
      makeRow({ status: "moved", left: "deep/a.md", right: "a.md" }),
      "left",
      0,
      "align-right",
    );
    expect(actions[0]).toMatchObject({ kind: "move", side: "left", toPath: "a.md" });
  });

  it("keep 下 moved 不产生动作", () => {
    expect(
      actionForRow(makeRow({ status: "moved", left: "a.md", right: "b.md" }), "right", 0, "keep"),
    ).toEqual([]);
  });

  it("本侧独有且以对侧为准 → 软删除", () => {
    const actions = actionForRow(
      makeRow({ status: "left-only", left: "a.md" }),
      "left",
      1,
      "align-right",
    );
    expect(actions).toEqual([
      {
        kind: "soft-delete",
        side: "left",
        fromPath: null,
        toPath: "a.md",
        status: "left-only",
        rowIndex: 1,
      },
    ]);
  });

  it("被忽略与目标阻断的行不产生动作", () => {
    expect(actionForRow(makeRow({ status: "ignored" }), "right", 0, "align-left")).toEqual([]);
    expect(actionForRow(makeRow({ status: "target-blocked" }), "right", 0, "align-left")).toEqual(
      [],
    );
  });
});
