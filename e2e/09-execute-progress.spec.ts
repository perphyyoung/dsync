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

  /* 强制走单文件并行路径：设置 2 个分块线程、磁盘按固态处理 */
  await page.evaluate(async () => {
    await window.api.setCopyThreads(2);
    await window.api.setDiskMode("ssd");
  });

  /* 单行复制：非预览模式点 > 按钮；悬停提示列出实际动作 */
  const syncRight = page.getByRole("button", { name: /^以左侧为准同步到右侧/ });
  await expect(syncRight).toHaveAttribute("title", /复制 .+/);
  await syncRight.click();
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
  await expect(page.getByText("同步中", { exact: true })).toHaveCount(0, { timeout: 2_000 });
  await expect(page.getByText("正在刷新列表…")).toHaveCount(0, { timeout: 5_000 });
  log.info("[e2e] 大文件复制进度窗出现，最小化/恢复后完成，刷新完成后关闭");
});

test("关闭自动关窗后，完成态保留窗口并显示用时与平均速度", async ({ slot }) => {
  /* 真实复制 128MB + 扫描哈希，磁盘慢时留足时间 */
  test.setTimeout(60_000);
  const { app, page, base } = slot;
  /* 同一 spec 共用一个应用实例：换一套空目录，避免与上一个用例的文件配对 */
  const left = join(base, "left2");
  const right = join(base, "right2");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });

  const big = join(left, "big.bin");
  await writeFile(big, "", "utf8");
  await truncate(big, 128 * 1024 * 1024);

  /* 上一个用例结束时停在主界面；当前若已在设置页则不重复进入 */
  if ((await page.getByText("扫描设置", { exact: true }).count()) === 0) {
    await page.getByRole("button", { name: "重新扫描", exact: true }).click();
  }

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

  /* 关掉「完成即关窗」，改为手动关闭后查看统计 */
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const autoClose = page.getByLabel("复制完成后自动关闭进度窗");
  await expect(autoClose).toBeChecked();
  await autoClose.uncheck();
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await page.getByRole("button", { name: /^以左侧为准同步到右侧/ }).click();
  /* 动态文案用正则（模板换行会保留在 textContent 里，空白一律用 \s+）：`用时 0.4 秒 · 平均 296 MB/s` */
  const stats = page.getByText(/用时\s+[\d.]+\s+秒\s+·\s+平均\s+[\d.]+\s+[KM]?B\/s/);
  await expect(stats).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(stats).toHaveCount(0);
  log.info("[e2e] 关闭自动关窗后，完成态保留窗口并显示用时与平均速度");
});
