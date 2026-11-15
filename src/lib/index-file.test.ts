import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyIndex,
  mergePairs,
  patchIndex,
  readIndex,
  rebaseIndex,
  writeIndex,
} from "./index-file";
import type { IndexData, PairRecord } from "./types";

function samplePair(left: string, right: string, base = "h1"): PairRecord {
  return {
    left,
    right,
    base,
    leftCache: { hash: base, size: 1, mtimeMs: 1 },
    rightCache: { hash: base, size: 1, mtimeMs: 1 },
    pairedBy: "index",
    syncedAt: null,
  };
}

function withPairs(left: string, right: string, pairs: PairRecord[]): IndexData {
  return {
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    roots: { left, right },
    pairs,
  };
}

describe("索引读写（SQLite）", () => {
  let work = "";

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "dsync-idx-"));
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("写入后原样读回", async () => {
    await writeIndex(work, withPairs(work, work, [samplePair("a.md", "b/a.md")]));

    const outcome = await readIndex(work);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.data?.pairs).toHaveLength(1);
    expect(outcome.data?.pairs[0]).toMatchObject({ left: "a.md", right: "b/a.md" });
    expect(outcome.data?.pairs[0]?.leftCache?.hash).toBe("h1");
    expect(outcome.data?.pairs[0]?.rightCache?.size).toBe(1);
  });

  it("patchIndex 只改给定配对", async () => {
    await writeIndex(
      work,
      withPairs(work, work, [samplePair("a.md", "a.md"), samplePair("b.md", "b.md")]),
    );

    await patchIndex(work, {
      upserts: [{ ...samplePair("a.md", "a.md"), leftCache: { hash: "new", size: 9, mtimeMs: 9 } }],
      deletes: [{ left: "b.md", right: "b.md" }],
    });

    const outcome = await readIndex(work);
    expect(outcome.data?.pairs).toHaveLength(1);
    expect(outcome.data?.pairs[0]?.leftCache?.hash).toBe("new");
  });

  it("索引不存在时返回 null 且无警告", async () => {
    const outcome = await readIndex(work);
    expect(outcome.data).toBeNull();
    expect(outcome.warnings).toEqual([]);
  });

  it("不是数据库的文件视为不可用", async () => {
    await mkdir(join(work, ".dsync"), { recursive: true });
    await writeFile(join(work, ".dsync", "dsync.db"), "这不是数据库内容");

    const outcome = await readIndex(work);
    expect(outcome.data).toBeNull();
    expect(outcome.warnings).toHaveLength(1);
  });

  it("空索引可用", () => {
    expect(emptyIndex("D:\\a", "E:\\b").pairs).toHaveLength(0);
  });
});

describe("索引重定基", () => {
  it("子目录索引并入父根时拼前缀", () => {
    const index = withPairs("D:\\work\\a", "E:\\backup\\b", [samplePair("x.md", "y.md")]);
    const pairs = rebaseIndex(index, "D:\\work", "E:\\backup");
    expect(pairs).not.toBeNull();
    expect(pairs?.[0]).toMatchObject({ left: "a/x.md", right: "b/y.md" });
  });

  it("父根索引缩小到子目录时剥前缀", () => {
    const index = withPairs("D:\\work", "E:\\backup", [samplePair("a/x.md", "b/y.md")]);
    const pairs = rebaseIndex(index, "D:\\work\\a", "E:\\backup\\b");
    expect(pairs?.[0]).toMatchObject({ left: "x.md", right: "y.md" });
  });

  it("不在范围内的路径被丢弃，其余保留", () => {
    const index = withPairs("D:\\work", "E:\\backup", [
      samplePair("a/x.md", "b/y.md"),
      samplePair("other/z.md", "b/w.md"),
    ]);
    const pairs = rebaseIndex(index, "D:\\work\\a", "E:\\backup\\b");
    expect(pairs).toHaveLength(1);
    expect(pairs?.[0].left).toBe("x.md");
  });

  it("根目录无关时整份放弃", () => {
    const index = withPairs("D:\\work", "E:\\backup", [samplePair("a/x.md", "b/y.md")]);
    expect(rebaseIndex(index, "D:\\other", "E:\\backup")).toBeNull();
  });
});

describe("配对合并", () => {
  it("当前索引优先，继承的只在两侧路径都空闲时并入", () => {
    const current = [samplePair("a.md", "b.md")];
    const inherited = [samplePair("a.md", "c.md"), samplePair("x.md", "y.md")];
    const merged = mergePairs(current, inherited);
    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ left: "x.md", right: "y.md" });
  });
});
