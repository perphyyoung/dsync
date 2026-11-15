import { describe, expect, it } from "vitest";
import { pairFiles } from "./pair";
import { collection, entry } from "./test-helpers";

describe("哈希唯一配对", () => {
  it("同路径且内容相同：配对", () => {
    const result = pairFiles(collection(entry("a.md", "h1")), collection(entry("a.md", "h1")));
    expect(result.pairs[0]).toMatchObject({
      left: "a.md",
      right: "a.md",
      pairedBy: "hash",
      base: "h1",
    });
  });

  it("同路径但内容不同：不配对，两侧独有", () => {
    const result = pairFiles(collection(entry("a.md", "h1")), collection(entry("a.md", "h2")));
    expect(result.pairs).toHaveLength(0);
    expect(result.leftOnly).toEqual(["a.md"]);
    expect(result.rightOnly).toEqual(["a.md"]);
  });

  it("路径不同但内容相同：配对，用于识别改名", () => {
    const result = pairFiles(
      collection(entry("old/a.md", "h1")),
      collection(entry("new/b.md", "h1")),
    );
    expect(result.pairs[0]).toMatchObject({
      left: "old/a.md",
      right: "new/b.md",
      pairedBy: "hash",
    });
  });

  it("单侧重复哈希：不配对", () => {
    const result = pairFiles(
      collection(entry("l1.md", "h1"), entry("l2.md", "h1")),
      collection(entry("r1.md", "h1")),
    );
    expect(result.pairs).toHaveLength(0);
    expect(result.leftOnly).toHaveLength(2);
    expect(result.rightOnly).toEqual(["r1.md"]);
  });

  it("两侧都重复：不配对", () => {
    const result = pairFiles(
      collection(entry("l1.md", "h1"), entry("l2.md", "h1")),
      collection(entry("r1.md", "h1"), entry("r2.md", "h1")),
    );
    expect(result.pairs).toHaveLength(0);
    expect(result.leftOnly).toHaveLength(2);
    expect(result.rightOnly).toHaveLength(2);
  });

  it("一个哈希配不上不影响其他哈希", () => {
    const result = pairFiles(
      collection(entry("a.md", "h1"), entry("b.md", "h2")),
      collection(entry("b.md", "h2")),
    );
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ left: "b.md", right: "b.md" });
    expect(result.leftOnly).toEqual(["a.md"]);
  });
});
