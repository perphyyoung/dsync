import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("启动进扫描设置页，返回后显示窗口骨架", async ({ slot }) => {
  const { page } = slot;

  /* 启动即打开扫描设置页：目录与过滤条件在扫描前确认 */
  await expect(page.getByText("扫描设置", { exact: true })).toBeVisible();
  await expect(page.getByText("未选择左侧目录", { exact: true })).toBeVisible();
  await expect(page.getByText("未选择右侧目录", { exact: true })).toBeVisible();
  /* 启动时还没有目录对档案：区块显示空态，列表满宽不出现滚动条 */
  await expect(page.getByText("最近目录对", { exact: true })).toBeVisible();
  await expect(page.getByText("还没有扫描成功过的目录对", { exact: true })).toBeVisible();
  /* 路径框宽度约为页面宽度的 70%（w-[70vw]） */
  const pathRatio = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll("span"));
    const target = spans.find((el) => el.textContent?.trim() === "未选择左侧目录");
    return target ? target.getBoundingClientRect().width / window.innerWidth : null;
  });
  expect(pathRatio).not.toBeNull();
  expect(pathRatio ?? 0).toBeGreaterThan(0.65);
  expect(pathRatio ?? 0).toBeLessThan(0.75);
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
  await expect(page.getByText("只含关键字", { exact: true })).toBeVisible();
  await expect(page.getByText("排除关键字", { exact: true })).toBeVisible();
  await expect(page.getByText("只含后缀", { exact: true })).toBeVisible();
  await expect(page.getByText("排除后缀", { exact: true })).toBeVisible();
  await expect(page.getByText("修改日期范围", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: "不限" })).toBeChecked();
  await expect(page.getByText("跳过隐藏文件", { exact: true })).toBeVisible();
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
  /* 目录表头中间列是左右互换：未选目录时禁用 */
  await expect(page.getByTitle("左右目录互换")).toBeVisible();
  await expect(page.getByTitle("左右目录互换")).toBeDisabled();
  /* 非预览模式不渲染复选框（表头的全选与行内勾选都只在预览时出现） */
  await expect(page.getByTitle("全选 / 取消全选")).toHaveCount(0);

  /* 扫描过滤行：只读摘要 + 重新扫描入口 */
  await expect(page.getByText("扫描条件", { exact: true })).toBeVisible();
  await expect(page.getByText("无过滤条件，全量显示")).toBeVisible();
  await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible();

  /* 显示过滤行：按列序排列的显示条件 */
  await expect(page.getByText("目录层级", { exact: true })).toBeVisible();
  await expect(page.getByLabel("关键字模式")).toHaveValue("include");
  await expect(page.getByLabel("后缀模式")).toHaveValue("include");
  await expect(page.getByText("修改日期范围", { exact: true })).toBeVisible();
  await expect(page.getByText("文件大小范围", { exact: true })).toBeVisible();
  await expect(page.getByText("跳过隐藏文件", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重置", exact: true })).toBeVisible();
  /* 第三行：显示模式行 */
  await expect(page.getByText("隐藏一致项", { exact: true })).toBeVisible();
  await expect(page.getByText("显示模式", { exact: true })).toBeVisible();
  for (const name of ["全部", "左侧", "右侧", "重复", "占用", "特殊"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }

  /* 文件列表三列表头：左右各一组，均可点击排序 */
  await expect(page.getByRole("button", { name: /^路径/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^修改日期/ })).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^大小/ })).toHaveCount(2);

  await expect(page.getByRole("button", { name: "向左同步预览", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "向右同步预览", exact: true })).toBeVisible();
  log.info("[e2e] 窗口骨架检查通过");
});
