import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashText } from "./hash";
import { refreshPaths } from "./refresh";

describe("目标级刷新", () => {
  let work = "";
  let left = "";
  let right = "";

  beforeEach(async () => {
    work = await mkdtemp(join(tmpdir(), "dsync-refresh-"));
    left = join(work, "left");
    right = join(work, "right");
    await mkdir(left, { recursive: true });
    await mkdir(right, { recursive: true });
  });

  afterEach(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("只读取目标文件，不创建索引", async () => {
    await writeFile(join(left, "a.md"), "abc", "utf8");
    await writeFile(join(right, "a.md"), "abc", "utf8");
    await writeFile(join(left, "other.md"), "other", "utf8");

    const rows = await refreshPaths(left, right, [{ rowIndex: 0, left: "a.md", right: "a.md" }]);
    expect(rows[0].left?.hash).toBe(hashText("abc"));
    expect(rows[0].right?.hash).toBe(hashText("abc"));
    expect(existsSync(join(left, ".dsync"))).toBe(false);
    expect(existsSync(join(right, ".dsync"))).toBe(false);
  });

  it("目标不存在时返回 null，不影响其他行", async () => {
    await writeFile(join(left, "a.md"), "abc", "utf8");
    const rows = await refreshPaths(left, right, [
      { rowIndex: 2, left: "a.md", right: "missing.md" },
    ]);
    expect(rows[0].left?.path).toBe("a.md");
    expect(rows[0].right).toBeNull();
  });
});
