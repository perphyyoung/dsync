import { mkdir } from "node:fs/promises";
import { join } from "node:path";
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
  await page.getByLabel("启用").check();
  await page.getByTitle("最小值", { exact: true }).fill("128");
  await page.getByLabel("目录层级").fill("2");
  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(page.getByLabel("启用")).toBeChecked();
  await expect(page.getByTitle("最小值", { exact: true })).toHaveValue("128");
  await expect(page.getByLabel("目录层级")).toHaveValue("2");

  /* 设置页改条件后返回主界面，过滤行同步显示 */
  await page.getByTitle("最小值", { exact: true }).fill("256");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByTitle("最小值", { exact: true })).toHaveValue("256");
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

test("过滤条件随目录对保存，重启后恢复", async ({ slot }) => {
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });

  /* 上个用例结束在设置页，先选目录再改条件 */
  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };
  await pickInto(left);
  await page.getByTitle("更改左侧目录").click();
  await pickInto(right);
  await page.getByTitle("更改右侧目录").click();

  await page.getByLabel("启用").check();
  await page.getByTitle("最小值", { exact: true }).fill("512");
  /* 扫描成功才记录目录对；条件在开始扫描时强制落盘 */
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();

  await slot.relaunch();

  await expect(slot.page.getByText("扫描设置", { exact: true })).toBeVisible();
  /* 目录行用标题定位：候选行里也有同一段路径文本 */
  await expect(slot.page.getByTitle(left, { exact: true })).toBeVisible();
  await expect(slot.page.getByLabel("启用")).toBeChecked();
  await expect(slot.page.getByTitle("最小值", { exact: true })).toHaveValue("512");
  /* 当前目录对在候选列表里带高亮 */
  const pairRow = slot.page.getByTitle(`${left} ⇄ ${right}`);
  await expect(pairRow.getByRole("button").first()).toHaveClass(/border-sky-700/);

  /* 搜索可一键清空 */
  const searchBox = slot.page.getByPlaceholder("搜索路径");
  await searchBox.fill("left");
  await slot.page.getByTitle("清空搜索").click();
  await expect(searchBox).toHaveValue("");
  log.info("[e2e] 重启后目录对与扫描条件均已恢复");
});

test("左右目录互换沿用同一套条件", async ({ slot }) => {
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");

  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };
  await pickInto(right);
  await page.getByTitle("更改左侧目录").click();
  await pickInto(left);
  await page.getByTitle("更改右侧目录").click();

  await expect(page.getByTitle("最小值", { exact: true })).toHaveValue("512");
  log.info("[e2e] 左右互换后条件保持不变");
});

test("删除目录对需要确认，当前目录对不可删", async ({ slot }) => {
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  const other = join(base, "other");
  await mkdir(other, { recursive: true });

  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  const pairRow = page.getByTitle(`${left} ⇄ ${right}`);
  /* 当前使用中的目录对不渲染删除按钮 */
  await expect(pairRow.getByTitle("删除目录对")).toHaveCount(0);

  /* 切走当前目录对后出现删除按钮 */
  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };
  await pickInto(other);
  await page.getByTitle("更改左侧目录").click();
  await expect(pairRow.getByTitle("删除目录对")).toBeVisible();

  /* 取消后保留 */
  await pairRow.getByTitle("删除目录对").click();
  await expect(page.getByText("删除该目录对的扫描条件存档，不会修改任何文件。")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(pairRow).toBeVisible();

  /* 确认后删除 */
  await pairRow.getByTitle("删除目录对").click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(pairRow).toHaveCount(0);
  await expect(page.getByText("还没有扫描成功过的目录对")).toBeVisible();
  log.info("[e2e] 当前目录对不可删，其他目录对确认后删除");
});
