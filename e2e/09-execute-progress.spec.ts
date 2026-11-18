import { mkdir, stat, truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("大文件复制显示进度窗，可最小化与恢复", async ({ slot }) => {
  test.setTimeout(60_000);
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });

  /* 稀疏大文件：扫描与复制都需要可观察的时间 */
  const big = join(left, "big.bin");
  await writeFile(big, "", "utf8");
  await truncate(big, 512 * 1024 * 1024);

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
  await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible({
    timeout: 20_000,
  });

  /* 单行复制：非预览模式点 > 按钮 */
  await page.getByTitle("以左侧为准同步到右侧", { exact: true }).click();
  await expect(page.getByText("同步中", { exact: true })).toBeVisible({ timeout: 5_000 });
  /* 限速入口在执行中可见（不改速率，避免拖慢用例） */
  await expect(page.getByLabel("复制限速")).toBeVisible();

  /* 最小化 → 胶囊 → 恢复 */
  await page.getByTitle("最小化").click();
  const pill = page.getByTitle("展开同步进度");
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.getByText("同步中", { exact: true })).toBeVisible();

  /* 等待复制完成：目标文件出现 */
  await expect
    .poll(
      async () => {
        try {
          return (await stat(join(right, "big.bin"))).size;
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(512 * 1024 * 1024);
  await expect(page.getByText("同步中", { exact: true })).toHaveCount(0, { timeout: 10_000 });
  log.info("[e2e] 大文件复制进度窗出现，最小化/恢复后完成");
});
