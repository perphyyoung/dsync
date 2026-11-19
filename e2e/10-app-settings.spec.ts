import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("扫描/复制线程数与磁盘类型可修改、重启后保留，并可恢复默认", async ({ slot }) => {
  const { page } = slot;

  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  const scanInput = page.getByLabel("扫描线程数");
  await expect(scanInput).toBeVisible();
  await scanInput.fill("1");
  await scanInput.blur();

  /* 手动修改后出现「恢复默认」，同时确认写入已完成 */
  await expect(page.getByRole("button", { name: "恢复默认", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("扫描线程数")).toHaveValue("1");
  await expect(page.getByText("已手动设置", { exact: true })).toHaveCount(1);

  /* 复制线程数与磁盘类型 */
  const copyInput = page.getByLabel("复制线程数");
  await copyInput.fill("2");
  await copyInput.blur();
  await page.getByLabel("磁盘类型").selectOption("hdd");
  await expect
    .poll(async () => (await page.evaluate(() => window.api.getAppSettings())).copyThreads)
    .toBe(2);
  await expect
    .poll(async () => (await page.evaluate(() => window.api.getAppSettings())).diskMode)
    .toBe("hdd");
  await expect(page.getByText("已手动设置", { exact: true })).toHaveCount(2);
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await slot.relaunch();
  await expect(slot.page.getByText("扫描设置", { exact: true })).toBeVisible();
  await expect(slot.page.getByLabel("扫描线程数")).toHaveValue("1");

  /* 恢复扫描默认，再验证复制设置 */
  await slot.page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(slot.page.getByRole("button", { name: "恢复默认", exact: true })).toHaveCount(0);

  await slot.page.getByRole("button", { name: "返回", exact: true }).click();
  await slot.page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(slot.page.getByLabel("复制线程数")).toHaveValue("2");
  await expect(slot.page.getByLabel("磁盘类型")).toHaveValue("hdd");
  await expect(slot.page.getByText("已手动设置", { exact: true })).toHaveCount(1);

  await slot.page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await slot.page.getByLabel("磁盘类型").selectOption("auto");
  await expect
    .poll(async () => (await slot.page.evaluate(() => window.api.getAppSettings())).copyThreadsAuto)
    .toBe(true);
  await expect
    .poll(async () => (await slot.page.evaluate(() => window.api.getAppSettings())).diskMode)
    .toBe("auto");

  log.info("[e2e] 扫描/复制线程数与磁盘类型修改、持久化与恢复默认完成");
});
