import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copyCachePairs } from "./copy-cache";
import { emptyIndex, patchIndex, readIndex, writeIndex } from "./index-file";
import type { CopyRecord } from "./types";

const base: CopyRecord = {
  side: "left",
  from: "a.md",
  to: "a.md",
  hash: "h1",
  size: 3,
  mtimeMs: 200,
  sourceMtimeMs: 100,
};

describe("复制缓存配对", () => {
  it("复制到左侧：目标缓存写左，源缓存写右", () => {
    const [pair] = copyCachePairs([base]);
    expect(pair).toMatchObject({
      left: "a.md",
      right: "a.md",
      leftCache: { hash: "h1", size: 3, mtimeMs: 200 },
      rightCache: { hash: "h1", size: 3, mtimeMs: 100 },
      pairedBy: "path",
    });
  });

  it("复制到右侧：源缓存写左，目标缓存写右", () => {
    const [pair] = copyCachePairs([{ ...base, side: "right", from: "b.md" }]);
    expect(pair).toMatchObject({
      left: "b.md",
      right: "a.md",
      leftCache: { mtimeMs: 100 },
      rightCache: { mtimeMs: 200 },
    });
  });

  it("patchIndex 能把复制缓存写进索引", async () => {
    const work = await mkdtemp(join(tmpdir(), "dsync-cache-"));
    const left = join(work, "left");
    const right = join(work, "right");
    await mkdir(left, { recursive: true });
    await mkdir(right, { recursive: true });
    try {
      await writeIndex(left, emptyIndex(left, right));
      await writeIndex(right, emptyIndex(left, right));
      const upserts = copyCachePairs([base]);
      await Promise.all([patchIndex(left, { upserts }), patchIndex(right, { upserts })]);

      const outcome = await readIndex(left);
      expect(outcome.data?.roots).toEqual({ left, right });
      expect(outcome.data?.pairs[0]).toMatchObject({
        left: "a.md",
        right: "a.md",
        leftCache: { hash: "h1", mtimeMs: 200 },
        rightCache: { hash: "h1", mtimeMs: 100 },
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
});
