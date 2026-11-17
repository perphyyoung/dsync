import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("启动自动打开扫描设置页，返回后可从主界面重新打开", async ({ slot }) => {
  const { page } = slot;

  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  log.info("[e2e] 启动自动打开设置页，返回进入主界面");

  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  log.info("[e2e] 主界面扫描入口可重新打开设置页");
});

test("过滤条件在主界面与设置页双向同步", async ({ slot }) => {
  const { page } = slot;

  /* 主界面改条件后打开设置页，应看到同一个值 */
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  await page.getByLabel("最小大小").fill("128");
  await page.getByLabel("目录层级").fill("2");
  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(page.getByLabel("最小大小")).toHaveValue("128");
  await expect(page.getByLabel("目录层级")).toHaveValue("2");

  /* 设置页改条件后返回主界面，过滤行同步显示 */
  await page.getByLabel("最小大小").fill("256");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByLabel("最小大小")).toHaveValue("256");
  log.info("[e2e] 条件在设置页与过滤行之间双向同步");
});

test("未选目录点开始扫描给出告警并停在设置页", async ({ slot }) => {
  const { page } = slot;

  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  await expect(page.getByText("请先选择左右两个目录", { exact: true })).toBeVisible();
  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  log.info("[e2e] 未选目录时提示并留在设置页");
});

test("过滤条件在重启后保留", async ({ slot }) => {
  const { page } = slot;

  /* 上个用例结束在设置页，改条件后重启 */
  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  await page.getByLabel("最小大小").fill("512");
  await slot.relaunch();

  await expect(slot.page.getByText("扫描设置", { exact: true })).toBeVisible();
  await expect(slot.page.getByLabel("最小大小")).toHaveValue("512");
  log.info("[e2e] 重启后扫描条件已从本地偏好恢复");
});
