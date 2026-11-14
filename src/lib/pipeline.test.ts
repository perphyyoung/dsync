import { mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeActions } from "./execute";
import { readIndex } from "./index-file";
import { runScan } from "./pipeline";
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
    includeExts: [],
    excludeExts: [],
    direction: "none",
    align: "keep",
    ignoreCache: false,
    ...overrides,
  };
}

const trash = async (fullPath: string): Promise<void> => {
  await rm(fullPath, { force: true });
};

describe("端到端扫描与执行", () => {
  it("内容相同但路径不同配成 moved，并能按右侧结构对齐", async () => {
    const { left, right } = await setup();
    await writeRel(left, "deep/notes.md", "hello");
    await writeRel(right, "notes.md", "hello");

    const scan = await runScan(request(left, right, { align: "align-right" }));
    expect(scan.rows).toHaveLength(1);
    expect(scan.rows[0]).toMatchObject({
      status: "moved",
      left: "deep/notes.md",
      right: "notes.md",
    });
    expect(scan.actions).toHaveLength(1);

    const result = await executeActions(
      { leftRoot: left, rightRoot: right, actions: scan.actions },
      { trash },
    );
    expect(result.moved).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(await readFile(join(left, "notes.md"), "utf8")).toBe("hello");
    await expect(readFile(join(left, "deep/notes.md"), "utf8")).rejects.toThrow();

    const after = await runScan(request(left, right, { align: "align-right" }));
    expect(after.rows[0].status).toBe("same");
  });

  it("内容不同时按左到右覆盖", async () => {
    const { left, right } = await setup();
    await writeRel(left, "a.md", "v2");
    await writeRel(right, "a.md", "v1");

    const scan = await runScan(request(left, right, { direction: "left-to-right" }));
    expect(scan.rows[0].status).toBe("diff");

    await executeActions({ leftRoot: left, rightRoot: right, actions: scan.actions }, { trash });
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

    const forced = await runScan(request(left, right, { ignoreCache: true }));
    expect(forced.rows[0].status).toBe("diff");
  });

  it("排除后缀与最小大小只影响可见性", async () => {
    const { left, right } = await setup();
    await writeRel(left, "keep.md", "0123456789");
    await writeRel(left, "skip.log", "0123456789");
    await writeRel(left, "tiny.md", "1");

    const scan = await runScan(
      request(left, right, { excludeExts: [".log"], minSize: 5, direction: "left-to-right" }),
    );
    expect(scan.rows.find((row) => row.left === "skip.log")?.status).toBe("ignored");
    expect(scan.rows.find((row) => row.left === "tiny.md")?.status).toBe("ignored");
    expect(scan.rows.find((row) => row.left === "keep.md")?.status).toBe("left-only");
    expect(scan.actions.every((action) => !action.toPath.endsWith(".log"))).toBe(true);
  });

  it("拒绝相同或互相包含的根目录", async () => {
    const { left } = await setup();
    await expect(runScan(request(left, left))).rejects.toThrow();
    await expect(runScan(request(left, join(left, "inner")))).rejects.toThrow();
  });

  it("父目录重新比较时复用子目录索引", async () => {
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
    expect(row?.pairedBy).toBe("inherited");
  });
});
