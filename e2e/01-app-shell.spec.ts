import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("窗口骨架：目录表头、过滤行、双栏与菜单", async ({ slot }) => {
  const { app, page } = slot;

  await expect(page.getByText("未选择左侧目录", { exact: true })).toBeVisible();
  await expect(page.getByText("未选择右侧目录", { exact: true })).toBeVisible();
  await expect(page.getByTitle("更改左侧目录")).toBeVisible();
  await expect(page.getByTitle("更改右侧目录")).toBeVisible();
  await expect(page.getByTitle("在文件管理器中打开")).toHaveCount(2);
  /* 表头的全选复选框（过滤行的「隐藏一致项」也是 checkbox，用 title 区分） */
  await expect(page.getByTitle("全选 / 取消全选")).toBeVisible();
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "强制重算", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "向左同步预览", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "向右同步预览", exact: true })).toBeVisible();

  const menu = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
  );
  expect(menu).toContain("文件");
  log.info("[e2e] 窗口骨架与菜单检查通过");
});
