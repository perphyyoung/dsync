import { mkdir, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("扫描过滤命中的文件不列行，特殊视图也不显示", async ({ slot }) => {
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  const old = new Date("2026-01-01T00:00:00.000Z");
  await writeFile(join(left, "old.txt"), "old", "utf8");
  await utimes(join(left, "old.txt"), old, old);
  await writeFile(join(left, "a.md"), "a", "utf8");
  await writeFile(join(right, "b.md"), "b", "utf8");

  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };
  await pickInto(left);
  await page.getByTitle("更改左侧目录").click();
  await pickInto(right);
  await page.getByTitle("更改右侧目录").click();

  /* 最近 7 天：old.txt 被时间过滤 */
  await page.getByRole("radio", { name: "最近" }).check();
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible();

  /* 过滤项不列行：全部视图没有它 */
  await expect(page.getByTitle("old.txt", { exact: true })).toHaveCount(0);
  await expect(page.getByText("2026-01-01", { exact: true })).toHaveCount(0);

  /* 特殊视图只放符号链接 / 特殊文件 / 读取失败，过滤项也不出现 */
  await page.getByRole("button", { name: "特殊", exact: true }).click();
  await expect(page.getByTitle("old.txt", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "特殊", exact: true })).toBeVisible();
  log.info("[e2e] 过滤命中的文件不列行，特殊视图不含过滤项");
});
