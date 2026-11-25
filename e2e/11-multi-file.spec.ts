import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";
import type { ExecuteRequest } from "../src/lib/types";

test("SSD 并行文件数可持久化，多文件复制走并行调度", async ({ slot }) => {
  test.setTimeout(60_000);
  const { page, base } = slot;

  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const filesInput = page.getByLabel("SSD 并行文件数");
  await expect(filesInput).toBeVisible();
  await filesInput.fill("3");
  await filesInput.blur();
  await expect
    .poll(async () => (await page.evaluate(() => window.api.getAppSettings())).ssdParallelFiles)
    .toBe(3);
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await slot.relaunch();
  await expect(slot.page.getByText("扫描设置", { exact: true })).toBeVisible();
  await slot.page.getByRole("button", { name: "返回", exact: true }).click();
  await slot.page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(slot.page.getByLabel("SSD 并行文件数")).toHaveValue("3");
  await expect(slot.page.getByRole("button", { name: "恢复默认", exact: true })).toHaveCount(1);
  await slot.page.getByRole("button", { name: "关闭", exact: true }).click();

  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  const contents = ["a", "bb", "ccc", "dddd"];
  for (const [index, value] of contents.entries()) {
    await writeFile(join(left, `f${index}.txt`), value, "utf8");
  }
  const actions = contents.map((value, index) => ({
    kind: "copy" as const,
    side: "right" as const,
    fromPath: `f${index}.txt`,
    toPath: `f${index}.txt`,
    status: "left-only" as const,
    rowIndex: index,
    sizeBytes: value.length,
  }));

  await slot.page.evaluate(
    async ({ left: leftRoot, right: rightRoot }) => {
      await window.api.setDirDisk(leftRoot, "ssd");
      await window.api.setDirDisk(rightRoot, "ssd");
    },
    { left, right },
  );

  const input: ExecuteRequest = { leftRoot: left, rightRoot: right, actions };
  const result = await slot.page.evaluate(async (request) => window.api.execute(request), input);
  expect(result.copied).toBe(contents.length);
  for (const [index, value] of contents.entries()) {
    expect(await readFile(join(right, `f${index}.txt`), "utf8")).toBe(value);
  }

  log.info("[e2e] SSD 并行文件数持久化与多文件复制完成");
});
