import { describe, expect, it } from "vitest";
import { decodeIndex, emptyIndex, encodeIndex, mergePairs, rebaseIndex } from "./index-file";
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

describe("索引容器", () => {
  it("编解码往返一致", () => {
    const data = withPairs("D:\\a", "E:\\b", [samplePair("x.md", "y.md")]);
    const decoded = decodeIndex(encodeIndex(data));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.verified).toBe(true);
    expect(decoded.data.pairs).toHaveLength(1);
    expect(decoded.data.roots).toEqual({ left: "D:\\a", right: "E:\\b" });
  });

  it("尾部被打了一个字节仍然能解析，只是校验不过", () => {
    const buffer = encodeIndex(withPairs("D:\\a", "E:\\b", [samplePair("x.md", "y.md")]));
    const tampered = Buffer.from(buffer);
    tampered[tampered.length - 1] ^= 0xff;
    const decoded = decodeIndex(tampered);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.verified).toBe(false);
    expect(decoded.data.pairs).toHaveLength(1);
  });

  it("长度不符直接拒绝", () => {
    const buffer = encodeIndex(withPairs("D:\\a", "E:\\b", []));
    expect(decodeIndex(buffer.subarray(0, buffer.length - 3)).ok).toBe(false);
  });

  it("乱码拒绝", () => {
    expect(
      decodeIndex(Buffer.from("这是一段完全不是索引的内容，长度足够但魔数不对。".repeat(3))).ok,
    ).toBe(false);
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
