import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("扫描线程数可修改、重启后保留，并可恢复默认", async ({ slot }) => {
  const { page } = slot;

  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  const threads = page.getByLabel("扫描线程数");
  await expect(threads).toBeVisible();
  await threads.fill("1");
  await threads.blur();

  /* 手动修改后出现「恢复默认」，同时确认写入已完成 */
  await expect(page.getByRole("button", { name: "恢复默认", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByLabel("扫描线程数")).toHaveValue("1");
  await expect(page.getByText("已手动设置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await slot.relaunch();
  await expect(slot.page.getByText("扫描设置", { exact: true })).toBeVisible();
  await expect(slot.page.getByLabel("扫描线程数")).toHaveValue("1");
  await expect(slot.page.getByRole("button", { name: "恢复默认", exact: true })).toBeVisible();

  await slot.page.getByRole("button", { name: "恢复默认", exact: true }).click();
  await expect(slot.page.getByRole("button", { name: "恢复默认", exact: true })).toHaveCount(0);

  log.info("[e2e] 扫描线程数修改、持久化与恢复默认完成");
});
