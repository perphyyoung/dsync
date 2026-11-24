import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("预览统计的复选框批量控制行勾选", async ({ slot }) => {
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  await writeFile(join(left, "a.md"), "a", "utf8");
  await writeFile(join(left, "b.md"), "b", "utf8");
  await writeFile(join(right, "c.md"), "c", "utf8");

  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };
  await pickInto(left);
  await page.getByTitle("更改左侧目录").click();
  await pickInto(right);
  await page.getByTitle("更改右侧目录").click();
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible();

  /* 行内显示修改日期，只到天 */
  await expect(page.getByText(/^\d{4}-\d{2}-\d{2}$/).first()).toBeVisible();

  /* 点击表头三态循环：默认 → 升序 → 降序 → 默认 */
  const yOf = async (path: string): Promise<number> => {
    const box = await page.getByTitle(path, { exact: true }).first().boundingBox();
    return box?.y ?? 0;
  };
  const pathHeader = page.getByRole("button", { name: /^路径/ }).first();
  expect(await yOf("a.md")).toBeLessThan(await yOf("c.md"));

  await pathHeader.click();
  await expect(page.getByText("↑", { exact: true }).first()).toBeVisible();
  expect(await yOf("a.md")).toBeLessThan(await yOf("c.md"));

  await pathHeader.click();
  await expect(page.getByText("↓", { exact: true }).first()).toBeVisible();
  expect(await yOf("c.md")).toBeLessThan(await yOf("a.md"));

  await pathHeader.click();
  await expect(page.getByText("↑", { exact: true })).toHaveCount(0);
  await expect(page.getByText("↓", { exact: true })).toHaveCount(0);
  expect(await yOf("a.md")).toBeLessThan(await yOf("c.md"));

  /* 互换左右目录：结果直接镜像，不需要重新扫描 */
  await page.getByTitle("左右目录互换").click();
  await expect(page.getByTestId("stat-rightOnly")).toHaveText(/仅右侧\s*2/);
  await expect(page.getByTitle("a.md", { exact: true })).toBeVisible();
  await expect(page.getByText("先选择左右两个目录")).toHaveCount(0);
  await page.getByTitle("左右目录互换").click();
  await expect(page.getByTestId("stat-leftOnly")).toHaveText(/仅左侧\s*2/);

  /* 向右同步：左侧两个文件复制到右侧，右侧独有文件软删除 */
  await page.getByRole("button", { name: "向右同步预览" }).click();
  const copy = page.getByRole("checkbox", { name: "复制" });
  const rowBoxes = page.getByLabel(/^选择第/);
  const checkedRows = (): Promise<boolean[]> =>
    rowBoxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked));

  await expect(copy).toBeChecked();
  await expect(page.getByText("复制 2")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "软删除" })).toBeChecked();
  await expect(page.getByText("软删除 1")).toBeVisible();

  /* 取消复制：只留下软删除那行 */
  await copy.uncheck();
  await expect(page.getByText("复制 0")).toBeVisible();
  await expect(page.getByText("软删除 1")).toBeVisible();
  expect((await checkedRows()).filter(Boolean)).toHaveLength(1);

  /* 再勾选：整组恢复 */
  await copy.check();
  await expect(page.getByText("复制 2")).toBeVisible();
  expect((await checkedRows()).every(Boolean)).toBe(true);
  log.info("[e2e] 预览统计复选框批量控制行勾选");
});
