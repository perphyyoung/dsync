import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { launchApp, makeWorkdir } from "./e2e-helper";
import { log } from "./e2e-logger";

test("右键软删除进回收站，重扫后不再出现", async () => {
  const base = await makeWorkdir("dsync-soft-delete-");
  const appData = join(base, "appdata");
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(appData, { recursive: true });
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  await writeFile(join(left, "a.md"), "left-only", "utf8");

  const { app, page } = await launchApp(appData);
  log.info("[e2e] 软删除用例启动");

  /* 目录选择走系统对话框，e2e 里直接替换成固定路径 */
  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };

  await pickInto(left);
  await page.getByText("选择左侧目录", { exact: true }).click();
  await pickInto(right);
  await page.getByText("选择右侧目录", { exact: true }).click();

  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(page.getByText("a.md", { exact: true })).toBeVisible({ timeout: 5000 });
  log.info("[e2e] 扫描完成，a.md 已在列表");

  await page.getByText("a.md", { exact: true }).click({ button: "right" });
  await page.getByRole("button", { name: /软删除左侧文件/ }).click();
  await page.getByRole("button", { name: "移入回收站" }).click();

  /* 原位置应已没有该文件 */
  await expect
    .poll(
      async () => {
        try {
          await readFile(join(left, "a.md"), "utf8");
          return "exists";
        } catch {
          return "gone";
        }
      },
      { timeout: 5000 },
    )
    .toBe("gone");
  log.info("[e2e] 原位置文件已移走");

  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(page.getByText("a.md", { exact: true })).toBeVisible();
  log.info("[e2e] 回收站里能看到刚删的文件");

  await page.getByRole("button", { name: "返回", exact: true }).click();

  await page.getByRole("button", { name: "扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible({
    timeout: 5000,
  });
  await expect(page.getByText("a.md", { exact: true })).toHaveCount(0);
  log.info("[e2e] 重扫后已删除内容不再出现");

  await app.close();
  await rm(base, { recursive: true, force: true });
});
