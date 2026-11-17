import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScanCancelledError, ScanController } from "./controller";
import { executeActions } from "./execute";
import { readIndex } from "./index-file";
import { migrateMoveCaches } from "./index-migrate";
import { detectStale } from "./refresh";
import { verifyOutcome } from "./verify";
import { runScan } from "./pipeline";
import { actionForRow } from "./plan";
import { makeBase, writeRel } from "./test-helpers";
import type { ScanRequest } from "./types";

async function setup(): Promise<{ left: string; right: string }> {
  const base = await makeBase("dsync-pipeline-");
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  return { left, right };
}

function request(left: string, right: string, overrides: Partial<ScanRequest> = {}): ScanRequest {
  return {
    leftRoot: left,
    rightRoot: right,
    minSize: 0,
    maxSize: 0,
    maxDepth: 0,
    excludePaths: [],
    modifiedAfter: 0,
    modifiedBefore: 0,
    skipHidden: false,
    includeExts: [],
    excludeExts: [],
    forceRehash: false,
    ...overrides,
  };
}

const softDelete = async (root: string, relPath: string): Promise<void> => {
  await rm(join(root, relPath), { force: true });
};

describe("端到端扫描与执行", () => {
  it("内容相同但路径不同配成 moved，并能按右侧结构对齐", async () => {
    const { left, right } = await setup();
    await writeRel(left, "deep/notes.md", "hello");
    await writeRel(right, "notes.md", "hello");

    const scan = await runScan(request(left, right));
    expect(scan.rows).toHaveLength(1);
    expect(scan.rows[0]).toMatchObject({
      status: "moved",
      left: "deep/notes.md",
      right: "notes.md",
    });

    const actions = actionForRow(scan.rows[0], "left", 0, "align-right");
    expect(actions).toHaveLength(1);

    const result = await executeActions(
      { leftRoot: left, rightRoot: right, actions },
      { softDelete },
    );
    expect(result.moved).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(await readFile(join(left, "notes.md"), "utf8")).toBe("hello");
    await expect(readFile(join(left, "deep/notes.md"), "utf8")).rejects.toThrow();

    const after = await runScan(request(left, right));
    expect(after.rows[0].status).toBe("same");
  });

  it("对侧独有时复制过去", async () => {
    const { left, right } = await setup();
    await writeRel(left, "a.md", "v2");

    const scan = await runScan(request(left, right));
    expect(scan.rows[0].status).toBe("left-only");

    const actions = actionForRow(scan.rows[0], "right", 0, "keep");
    await executeActions({ leftRoot: left, rightRoot: right, actions }, { softDelete });
    expect(await readFile(join(right, "a.md"), "utf8")).toBe("v2");
  });

  it("索引落在两侧 .dsync，二次扫描复用缓存", async () => {
    const { left, right } = await setup();
    const fixed = new Date("2026-01-01T00:00:00.000Z");
    await writeRel(left, "a.md", "abc");
    await utimes(join(left, "a.md"), fixed, fixed);
    await writeRel(right, "a.md", "abc");

    await runScan(request(left, right));
    const leftIndex = await readIndex(left);
    const rightIndex = await readIndex(right);
    expect(leftIndex.data?.pairs).toHaveLength(1);
    expect(leftIndex.warnings).toHaveLength(0);
    expect(rightIndex.data?.pairs).toHaveLength(1);
    expect(leftIndex.data?.pairs[0].leftCache?.mtimeMs).toBe(fixed.getTime());

    // 内容变了，但大小与 mtime 都被复原：缓存命中，仍判为一致
    await writeFile(join(left, "a.md"), "xyz");
    await utimes(join(left, "a.md"), fixed, fixed);

    const cached = await runScan(request(left, right));
    expect(cached.rows[0].status).toBe("same");

    const forced = await runScan(request(left, right, { forceRehash: true }));
    expect(forced.rows[0].status).toBe("target-blocked");
  });

  it("排除后缀与最小大小只影响可见性", async () => {
    const { left, right } = await setup();
    await writeRel(left, "keep.md", "0123456789");
    await writeRel(left, "skip.log", "0123456789");
    await writeRel(left, "tiny.md", "1");

    const scan = await runScan(request(left, right, { excludeExts: [".log"], minSize: 5 }));
    expect(scan.rows.find((row) => row.left === "skip.log")?.status).toBe("ignored");
    expect(scan.rows.find((row) => row.left === "tiny.md")?.status).toBe("ignored");
    expect(scan.rows.find((row) => row.left === "keep.md")?.status).toBe("left-only");
  });

  it("最大大小上限只影响可见性", async () => {
    const { left, right } = await setup();
    await writeRel(left, "small.md", "1");
    await writeRel(left, "big.md", "0123456789");

    const scan = await runScan(request(left, right, { maxSize: 5 }));
    expect(scan.rows.find((row) => row.left === "big.md")?.status).toBe("ignored");
    expect(scan.rows.find((row) => row.left === "small.md")?.status).toBe("left-only");
  });

  it("目录层级超限的目录整棵跳过，不产生 ignored 行", async () => {
    const { left, right } = await setup();
    await writeRel(left, "root.md", "root");
    await writeRel(left, "one/inner.md", "inner");
    await writeRel(left, "one/two/deep.md", "deep");

    const scan = await runScan(request(left, right, { maxDepth: 2 }));
    expect(scan.rows.find((row) => row.left === "root.md")?.status).toBe("left-only");
    expect(scan.rows.find((row) => row.left === "one/inner.md")?.status).toBe("left-only");
    expect(scan.rows.find((row) => row.left === "one/two/deep.md")).toBeUndefined();
  });

  it("排除路径跳过目录整棵与命中文件", async () => {
    const { left, right } = await setup();
    await writeRel(left, "keep.md", "keep");
    await writeRel(left, "node_modules/pkg.mjs", "pkg");
    await writeRel(left, "dist/out.md", "out");

    const scan = await runScan(request(left, right, { excludePaths: ["node_modules", "out.md"] }));
    expect(scan.rows.find((row) => row.left === "keep.md")?.status).toBe("left-only");
    expect(scan.rows.find((row) => row.left === "node_modules/pkg.mjs")).toBeUndefined();
    expect(scan.rows.find((row) => row.left === "dist/out.md")).toBeUndefined();
  });

  it("隐藏文件按开关整棵跳过", async () => {
    const { left, right } = await setup();
    await writeRel(left, ".env", "secret");
    await writeRel(left, ".git/config", "config");
    await writeRel(left, "visible.md", "visible");

    const hidden = await runScan(request(left, right, { skipHidden: true }));
    expect(hidden.rows.find((row) => row.left === ".env")).toBeUndefined();
    expect(hidden.rows.find((row) => row.left === ".git/config")).toBeUndefined();
    expect(hidden.rows.find((row) => row.left === "visible.md")?.status).toBe("left-only");

    const shown = await runScan(request(left, right, { skipHidden: false }));
    expect(shown.rows.find((row) => row.left === ".env")?.status).toBe("left-only");
  });

  it("修改时间窗口过滤过期文件", async () => {
    const { left, right } = await setup();
    const old = new Date("2026-01-01T00:00:00.000Z");
    await writeRel(left, "old.md", "old");
    await utimes(join(left, "old.md"), old, old);
    await writeRel(left, "new.md", "new");

    const after = new Date("2026-06-01T00:00:00.000Z").getTime();
    const scan = await runScan(request(left, right, { modifiedAfter: after }));
    expect(scan.rows.find((row) => row.left === "old.md")?.status).toBe("ignored");
    expect(scan.rows.find((row) => row.left === "new.md")?.status).toBe("left-only");
  });

  it("拒绝相同或互相包含的根目录", async () => {
    const { left } = await setup();
    await expect(runScan(request(left, left))).rejects.toThrow();
    await expect(runScan(request(left, join(left, "inner")))).rejects.toThrow();
  });

  it("父目录重新比较时按哈希重新配对", async () => {
    const base = await makeBase("dsync-inherit-");
    const work = join(base, "work");
    const backup = join(base, "backup");
    const leftChild = join(work, "a");
    const rightChild = join(backup, "b");
    await mkdir(leftChild, { recursive: true });
    await mkdir(rightChild, { recursive: true });

    await writeRel(leftChild, "x.md", "same");
    await writeRel(rightChild, "y.md", "same");

    const first = await runScan(request(leftChild, rightChild));
    expect(first.rows[0].status).toBe("moved");

    const second = await runScan(request(work, backup));
    const row = second.rows.find((item) => item.left === "a/x.md");
    expect(row).toBeDefined();
    expect(row?.right).toBe("b/y.md");
    expect(row?.pairedBy).toBe("hash");
  });

  it("进度回调覆盖扫描、哈希、配对、索引四个阶段", async () => {
    const { left, right } = await setup();
    await writeRel(left, "a.md", "abc");
    await writeRel(right, "a.md", "abc");

    const phases: string[] = [];
    await runScan(request(left, right), {
      onProgress: (progress) => {
        if (phases[phases.length - 1] !== progress.phase) phases.push(progress.phase);
      },
    });

    expect(phases).toEqual(["scan", "hash", "pair", "index"]);
  });

  it("已取消时抛出 ScanCancelledError", async () => {
    const { left, right } = await setup();
    await writeRel(left, "a.md", "abc");

    const controller = new ScanController();
    controller.cancel();

    await expect(runScan(request(left, right), { controller })).rejects.toBeInstanceOf(
      ScanCancelledError,
    );
  });

  it("move 动作记录路径映射", async () => {
    const { left, right } = await setup();
    await writeRel(left, "a.md", "abc");
    await writeRel(right, "b/a.md", "abc");

    const outcome = await executeActions(
      {
        leftRoot: left,
        rightRoot: right,
        actions: [
          {
            kind: "move",
            side: "right",
            fromPath: "b/a.md",
            toPath: "a.md",
            status: "moved",
            rowIndex: 0,
          },
        ],
      },
      { softDelete: async () => {} },
    );

    expect(outcome.moves).toEqual([{ side: "right", from: "b/a.md", to: "a.md" }]);
  });

  it("迁移后索引路径更新且缓存保留", async () => {
    const { left, right } = await setup();
    await writeRel(left, "a.md", "abc");
    await writeRel(right, "b/a.md", "abc");
    await runScan(request(left, right));

    const before = await readIndex(left);
    const hash = before.data?.pairs[0]?.rightCache?.hash;
    expect(hash).toBeTruthy();

    await migrateMoveCaches(left, right, [{ side: "right", from: "b/a.md", to: "a.md" }]);

    const after = await readIndex(left);
    expect(after.data?.pairs[0]?.right).toBe("a.md");
    expect(after.data?.pairs[0]?.rightCache?.hash).toBe(hash);
  });

  it("扫描后源文件被改，detectStale 报 source-changed", async () => {
    const { left, right } = await setup();
    await writeRel(left, "a.md", "old");
    await writeRel(right, "a.md", "old");
    await runScan(request(left, right));

    await writeRel(left, "a.md", "changed-after-scan");

    const loaded = await readIndex(left);
    const stale = await detectStale(
      {
        leftRoot: left,
        rightRoot: right,
        actions: [
          {
            kind: "copy",
            side: "right",
            fromPath: "a.md",
            toPath: "a.md",
            status: "left-only",
            rowIndex: 0,
          },
        ],
      },
      loaded.data?.pairs ?? [],
    );

    expect(stale).toEqual([{ path: "a.md", reason: "source-changed" }]);
  });

  it("目标路径被外部占用时 detectStale 报 target-created", async () => {
    const { left, right } = await setup();
    await writeRel(left, "a.md", "abc");
    await writeRel(right, "b/a.md", "abc");
    await runScan(request(left, right));

    await writeRel(right, "a.md", "external");

    const loaded = await readIndex(left);
    const stale = await detectStale(
      {
        leftRoot: left,
        rightRoot: right,
        actions: [
          {
            kind: "move",
            side: "right",
            fromPath: "b/a.md",
            toPath: "a.md",
            status: "moved",
            rowIndex: 0,
          },
        ],
      },
      loaded.data?.pairs ?? [],
    );

    expect(stale).toEqual([{ path: "a.md", reason: "target-created" }]);
  });

  it("执行后对账能发现内容不一致", () => {
    const mismatched = verifyOutcome(
      [
        {
          kind: "copy",
          side: "left",
          fromPath: "a.md",
          toPath: "a.md",
          status: "right-only",
          rowIndex: 0,
        },
      ],
      [
        {
          rowIndex: 0,
          left: { path: "a.md", hash: "h1", size: 3, mtimeMs: 1 },
          right: { path: "a.md", hash: "h2", size: 3, mtimeMs: 1 },
        },
      ],
    );

    expect(mismatched).toHaveLength(1);
    expect(mismatched[0]?.path).toBe("a.md");
  });
});
