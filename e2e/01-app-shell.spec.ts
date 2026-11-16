import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, makeWorkdir } from "./e2e-helper";
import { log } from "./e2e-logger";

test("窗口骨架：目录按钮、过滤行、双栏与菜单", async () => {
  const base = await makeWorkdir("dsync-shell-");
  const appData = join(base, "appdata");
  await mkdir(appData, { recursive: true });

  const { app, page } = await launchApp(appData);
  log.info("[e2e] 启动应用（窗口骨架）");

  await expect(page.getByText("选择左侧目录", { exact: true })).toBeVisible();
  await expect(page.getByText("选择右侧目录", { exact: true })).toBeVisible();
  await expect(page.getByText("左侧文件", { exact: true })).toBeVisible();
  await expect(page.getByText("右侧文件", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "强制重算", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "向左同步预览", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "向右同步预览", exact: true })).toBeVisible();

  const menu = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
  );
  expect(menu).toContain("文件");
  log.info("[e2e] 窗口骨架与菜单检查通过");

  await app.close();
  await rm(base, { recursive: true, force: true });
});
