import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeRelative,
  assertValidRootPair,
  isSameOrAncestor,
  normalizeRoot,
  resolveInsideRoot,
} from "./path-guard";

const base = join(tmpdir(), "dsync-guard");

describe("path-guard", () => {
  it("拒绝相同或互相包含的根目录", () => {
    expect(() => assertValidRootPair(base, base)).toThrow();
    expect(() => assertValidRootPair(base, join(base, "child"))).toThrow();
    expect(() => assertValidRootPair(join(base, "child"), base)).toThrow();
    expect(() => assertValidRootPair(base, join(tmpdir(), "dsync-other"))).not.toThrow();
  });

  it("祖先判断按路径段而非字符串前缀", () => {
    expect(isSameOrAncestor(base, join(base, "x"))).toBe(true);
    expect(isSameOrAncestor(base, `${base}-suffix`)).toBe(false);
  });

  it("大小写不敏感", () => {
    expect(isSameOrAncestor(base.toUpperCase(), base)).toBe(true);
  });

  it("盘符根不会被截断", () => {
    expect(normalizeRoot("C:/")).toBe("C:\\");
    expect(normalizeRoot("C:/work/")).toBe("C:\\work");
  });

  it("拒绝越界与非法相对路径", () => {
    expect(() => assertSafeRelative("../a")).toThrow();
    expect(() => assertSafeRelative("a/../b")).toThrow();
    expect(() => assertSafeRelative("a//b")).toThrow();
    expect(() => assertSafeRelative("C:/a")).toThrow();
    expect(() => assertSafeRelative("/abs")).toThrow();
    expect(() => assertSafeRelative("")).toThrow();
    expect(() => assertSafeRelative("a/b.md")).not.toThrow();
  });

  it("拼接结果必须留在根内", () => {
    expect(resolveInsideRoot(base, "a/b.md").toLowerCase()).toContain("b.md");
    expect(() => resolveInsideRoot(base, "../escape.md")).toThrow();
  });
});
