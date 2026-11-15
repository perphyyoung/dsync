import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listDeleted, restoreDeleted, softDelete } from "./recycle";

let work = "";

beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "dsync-recycle-"));
});

afterEach(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("内置回收站", () => {
  it("软删除移走文件并记录原路径", async () => {
    await mkdir(join(work, "docs"), { recursive: true });
    await writeFile(join(work, "docs/a.md"), "hello");

    await softDelete(work, "docs/a.md");

    await expect(readFile(join(work, "docs/a.md"), "utf8")).rejects.toThrow();
    const items = await listDeleted(work, "left");
    expect(items).toHaveLength(1);
    expect(items[0].path).toBe("docs/a.md");
  });

  it("还原回原路径并清掉记录", async () => {
    await writeFile(join(work, "a.md"), "hello");
    await softDelete(work, "a.md");
    const [item] = await listDeleted(work, "left");

    const path = await restoreDeleted(work, item.id);

    expect(path).toBe("a.md");
    expect(await readFile(join(work, "a.md"), "utf8")).toBe("hello");
    expect(await listDeleted(work, "left")).toHaveLength(0);
  });

  it("原位置被占用时拒绝还原", async () => {
    await writeFile(join(work, "a.md"), "old");
    await softDelete(work, "a.md");
    const [item] = await listDeleted(work, "left");
    await writeFile(join(work, "a.md"), "new");

    await expect(restoreDeleted(work, item.id)).rejects.toThrow("已有文件");
  });
});
