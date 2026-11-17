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
  await expect(page.getByText("目录层级", { exact: true })).toBeVisible();
  await expect(page.getByText("排除路径", { exact: true })).toBeVisible();
  await expect(page.getByText("修改时间", { exact: true })).toBeVisible();
  await expect(page.getByText("跳过隐藏文件")).toBeVisible();
  await expect(page.getByText("只含后缀", { exact: true })).toBeVisible();
  await expect(page.getByText("排除后缀", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "开始扫描", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "强制重算", exact: true })).toBeVisible();
  log.info("[e2e] 扫描设置页骨架检查通过");

  await page.getByRole("button", { name: "返回", exact: true }).click();

  await expect(page.getByText("未选择左侧目录", { exact: true })).toBeVisible();
  await expect(page.getByText("未选择右侧目录", { exact: true })).toBeVisible();
  await expect(page.getByTitle("在文件管理器中打开")).toHaveCount(2);
  /* 非预览模式不渲染复选框（表头的全选与行内勾选都只在预览时出现） */
  await expect(page.getByTitle("全选 / 取消全选")).toHaveCount(0);
  await expect(page.getByText("文件大小", { exact: true })).toBeVisible();
  await expect(page.getByText("目录层级", { exact: true })).toBeVisible();
  await expect(page.getByText("排除路径", { exact: true })).toBeVisible();
  await expect(page.getByText("修改时间", { exact: true })).toBeVisible();
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
