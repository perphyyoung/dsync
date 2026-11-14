import { describe, expect, it } from "vitest";
import { actionForRow, planSync, targetSide, type PlanInput } from "./plan";
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
    ignored: [],
    direction: "left-to-right",
    align: "keep",
    ...overrides,
  };
}

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

describe("单行动作（中间栏）", () => {
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

  it("内容不同时以左为准会复制并清掉右侧旧路径", () => {
    const actions = actionForRow(
      makeRow({ status: "diff", left: "a.md", right: "old.md" }),
      "right",
      1,
      "align-left",
    );
    expect(actions).toEqual([
      {
        kind: "copy",
        side: "right",
        fromPath: "a.md",
        toPath: "a.md",
        status: "diff",
        rowIndex: 1,
      },
      {
        kind: "delete",
        side: "right",
        fromPath: null,
        toPath: "old.md",
        status: "diff",
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

describe("目标侧判定", () => {
  it("align 优先于方向", () => {
    expect(targetSide("left-to-right", "align-right")).toBe("left");
    expect(targetSide("right-to-left", "align-left")).toBe("right");
    expect(targetSide("left-to-right", "keep")).toBe("right");
    expect(targetSide("none", "keep")).toBeNull();
  });
});

describe("计划生成", () => {
  it("内容不同时按方向生成复制动作", () => {
    const outcome = planSync(
      makeInput({
        pairs: [pair("a.md", "a.md")],
        left: collection(entry("a.md", "h1")),
        right: collection(entry("a.md", "h2")),
      }),
    );
    expect(outcome.rows[0].status).toBe("diff");
    expect(outcome.actions).toEqual([
      {
        kind: "copy",
        side: "right",
        fromPath: "a.md",
        toPath: "a.md",
        status: "diff",
        rowIndex: 0,
      },
    ]);
  });

  it("keep 模式下仅路径不同不产生动作", () => {
    const outcome = planSync(
      makeInput({
        pairs: [pair("deep/a.md", "a.md", "h1")],
        left: collection(entry("deep/a.md", "h1")),
        right: collection(entry("a.md", "h1")),
      }),
    );
    expect(outcome.rows[0].status).toBe("moved");
    expect(outcome.actions).toHaveLength(0);
    expect(outcome.stats.moved).toBe(1);
  });

  it("align-right 下路径不同的文件生成改名动作", () => {
    const outcome = planSync(
      makeInput({
        pairs: [pair("deep/a.md", "a.md", "h1")],
        left: collection(entry("deep/a.md", "h1")),
        right: collection(entry("a.md", "h1")),
        direction: "none",
        align: "align-right",
      }),
    );
    expect(outcome.actions).toEqual([
      {
        kind: "move",
        side: "left",
        fromPath: "deep/a.md",
        toPath: "a.md",
        status: "moved",
        rowIndex: 0,
      },
    ]);
  });

  it("align-right 下内容不同时复制到目标路径并删除旧路径", () => {
    const outcome = planSync(
      makeInput({
        pairs: [pair("deep/a.md", "a.md", "h1")],
        left: collection(entry("deep/a.md", "h2")),
        right: collection(entry("a.md", "h1")),
        direction: "none",
        align: "align-right",
      }),
    );
    expect(outcome.actions).toEqual([
      { kind: "copy", side: "left", fromPath: "a.md", toPath: "a.md", status: "diff", rowIndex: 0 },
      {
        kind: "delete",
        side: "left",
        fromPath: null,
        toPath: "deep/a.md",
        status: "diff",
        rowIndex: 0,
      },
    ]);
  });

  it("单侧文件只在目标侧缺失时复制", () => {
    const toRight = planSync(
      makeInput({
        leftOnly: ["x.md"],
        left: collection(entry("x.md", "h1")),
      }),
    );
    expect(toRight.actions).toEqual([
      {
        kind: "copy",
        side: "right",
        fromPath: "x.md",
        toPath: "x.md",
        status: "left-only",
        rowIndex: 0,
      },
    ]);

    const toLeft = planSync(
      makeInput({
        leftOnly: ["x.md"],
        left: collection(entry("x.md", "h1")),
        direction: "right-to-left",
      }),
    );
    expect(toLeft.actions).toHaveLength(0);
  });

  it("align-right 下左侧独有文件默认保留", () => {
    const outcome = planSync(
      makeInput({
        leftOnly: ["x.md"],
        left: collection(entry("x.md", "h1")),
        direction: "none",
        align: "align-right",
      }),
    );
    expect(outcome.actions).toHaveLength(0);
    expect(outcome.rows[0].status).toBe("left-only");
  });

  it("目标路径被未腾空的文件占用时标记阻断", () => {
    const outcome = planSync(
      makeInput({
        pairs: [pair("deep/a.md", "a.md", "h1")],
        left: collection(entry("deep/a.md", "h1"), entry("a.md", "h9")),
        right: collection(entry("a.md", "h1")),
        leftOnly: ["a.md"],
        direction: "none",
        align: "align-right",
      }),
    );
    const blocked = outcome.rows.find((row) => row.left === "deep/a.md");
    expect(blocked?.status).toBe("target-blocked");
    expect(outcome.stats.blocked).toBe(1);
    expect(outcome.actions).toHaveLength(0);
  });

  it("被忽略的文件只统计不产生动作", () => {
    const outcome = planSync(
      makeInput({
        ignored: [{ path: "a.log", reason: "ext", size: 10 }],
      }),
    );
    expect(outcome.stats.ignored).toBe(1);
    expect(outcome.actions).toHaveLength(0);
  });
});
