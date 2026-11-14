import { describe, expect, it } from "vitest";
import { pairFiles } from "./pair";
import { collection, entry } from "./test-helpers";
import type { PairRecord } from "./types";

function indexed(left: string, right: string, base: string | null): PairRecord {
  return {
    left,
    right,
    base,
    leftCache: null,
    rightCache: null,
    pairedBy: "manual",
    syncedAt: null,
  };
}

describe("四级配对", () => {
  it("相对路径相同即使内容不同也配对", () => {
    const result = pairFiles(collection(entry("a.md", "h1")), collection(entry("a.md", "h2")), []);
    expect(result.pairs[0]).toMatchObject({ left: "a.md", right: "a.md", pairedBy: "path" });
    expect(result.pairs[0].base).toBeNull();
  });

  it("只挪了层级时按文件名配对", () => {
    const result = pairFiles(
      collection(entry("deep/x.md", "h1")),
      collection(entry("x.md", "h1")),
      [],
    );
    expect(result.pairs[0]).toMatchObject({ left: "deep/x.md", right: "x.md", pairedBy: "name" });
    expect(result.pairs[0].base).toBe("h1");
  });

  it("改名且内容一致时按哈希配对", () => {
    const result = pairFiles(
      collection(entry("old/a.md", "h1")),
      collection(entry("new/b.md", "h1")),
      [],
    );
    expect(result.pairs[0]).toMatchObject({ pairedBy: "hash", base: "h1" });
  });

  it("重复内容不做哈希配对，避免张冠李戴", () => {
    const result = pairFiles(
      collection(entry("l1.md", "h1"), entry("l2.md", "h1")),
      collection(entry("r1.md", "h1"), entry("r2.md", "h1")),
      [],
    );
    expect(result.pairs).toHaveLength(0);
    expect(result.leftOnly).toHaveLength(2);
    expect(result.rightOnly).toHaveLength(2);
  });

  it("同名多份时退回归为单侧", () => {
    const result = pairFiles(
      collection(entry("a/x.md", "h1"), entry("b/x.md", "h2")),
      collection(entry("x.md", "h3")),
      [],
    );
    expect(result.pairs).toHaveLength(0);
    expect(result.rightOnly).toEqual(["x.md"]);
  });

  it("索引记忆优先，并保留原有 base", () => {
    const result = pairFiles(
      collection(entry("a.md", "h1"), entry("b.md", "h2")),
      collection(entry("b.md", "h1"), entry("a.md", "h2")),
      [indexed("a.md", "a.md", "h1")],
    );
    const pair = result.pairs.find((item) => item.left === "a.md");
    expect(pair).toMatchObject({ right: "a.md", base: "h1", pairedBy: "index" });
  });
});
