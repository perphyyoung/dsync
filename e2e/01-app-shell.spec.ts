import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("启动进扫描设置页，返回后显示窗口骨架", async ({ slot }) => {
  const { page } = slot;

  /* 启动即打开扫描设置页：目录与过滤条件在扫描前确认 */
  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  await expect(page.getByText("未选择左侧目录", { exact: true })).toBeVisible();
  await expect(page.getByText("未选择右侧目录", { exact: true })).toBeVisible();
  await expect(page.getByTitle("更改左侧目录")).toBeVisible();
  await expect(page.getByTitle("更改右侧目录")).toBeVisible();
  await expect(page.getByText("文件大小", { exact: true })).toBeVisible();
  /* 0 的含义走行末 ? 的悬停提示：问号常显，提示按空间翻转且不越出视口 */
  const sizeHint = page.getByText("0 表示该侧不限");
  await expect(sizeHint).not.toBeVisible();
  const questionMark = page.getByText("?", { exact: true }).first();
  await questionMark.hover();
  await expect(sizeHint).toBeVisible();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const hintBox = await sizeHint.boundingBox();
  expect(hintBox).not.toBeNull();
  if (hintBox) {
    expect(hintBox.x).toBeGreaterThanOrEqual(0);
    expect(hintBox.y).toBeGreaterThanOrEqual(0);
    expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(viewport.width);
    expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(viewport.height);
  }
  await expect(page.getByText("目录层级", { exact: true })).toBeVisible();
  await expect(page.getByText("排除路径", { exact: true })).toBeVisible();
  await expect(page.getByText("修改时间范围", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "不限" })).toBeChecked();
  await expect(page.getByText("隐藏文件", { exact: true })).toBeVisible();
  await expect(page.getByText("只含后缀", { exact: true })).toBeVisible();
  await expect(page.getByText("排除后缀", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始扫描", exact: true })).toBeVisible();
  /* 强制重算是红色复选框：默认不选中，勾选时弹确认 */
  const forceRehash = page.getByLabel("强制重算");
  await expect(forceRehash).not.toBeChecked();
  await forceRehash.check();
  await expect(page.getByText("重新计算全部文件哈希")).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(forceRehash).not.toBeChecked();
  await forceRehash.check();
  await page.getByRole("button", { name: "启用", exact: true }).click();
  await expect(forceRehash).toBeChecked();
  log.info("[e2e] 扫描设置页骨架检查通过");

  await page.getByRole("button", { name: "返回", exact: true }).click();

  await expect(page.getByText("未选择左侧目录", { exact: true })).toBeVisible();
  await expect(page.getByText("未选择右侧目录", { exact: true })).toBeVisible();
  await expect(page.getByTitle("在文件管理器中打开")).toHaveCount(2);
  /* 非预览模式不渲染复选框（表头的全选与行内勾选都只在预览时出现） */
  await expect(page.getByTitle("全选 / 取消全选")).toHaveCount(0);
  await expect(page.getByText("文件大小", { exact: true })).toBeVisible();
  /* 主界面过滤行贴近窗口顶部：提示翻到下方且不越界 */
  await page.getByText("?", { exact: true }).first().hover();
  await expect(sizeHint).toBeVisible();
  const mainHintBox = await sizeHint.boundingBox();
  expect(mainHintBox).not.toBeNull();
  if (mainHintBox) {
    expect(mainHintBox.x).toBeGreaterThanOrEqual(0);
    expect(mainHintBox.y).toBeGreaterThanOrEqual(0);
    expect(mainHintBox.x + mainHintBox.width).toBeLessThanOrEqual(viewport.width);
    expect(mainHintBox.y + mainHintBox.height).toBeLessThanOrEqual(viewport.height);
  }
  await expect(page.getByText("目录层级", { exact: true })).toBeVisible();
  await expect(page.getByText("排除路径", { exact: true })).toBeVisible();
  await expect(page.getByText("修改时间范围", { exact: true })).toBeVisible();
  await expect(page.getByText("跳过隐藏文件", { exact: true })).toBeVisible();
  await expect(page.getByText("显示模式", { exact: true })).toBeVisible();
  for (const name of ["全部", "左侧", "右侧", "重复", "占用"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  /* 过滤行保留扫描入口，强制重算已移入设置页 */
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "强制重算", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "向左同步预览", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "向右同步预览", exact: true })).toBeVisible();
  log.info("[e2e] 窗口骨架检查通过");
});
