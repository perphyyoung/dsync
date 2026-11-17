import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

/** 从当前页面发起扫描：在设置页直接开始，在主界面先点「扫描」进入设置页 */
async function scanViaSettings(page: Page): Promise<void> {
  if (!(await page.getByText("扫描设置", { exact: true }).isVisible())) {
    await page.getByRole("button", { name: "扫描", exact: true }).click();
  }
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
}

test("右键软删除进回收站，重扫后不再出现", async ({ slot }) => {
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  await writeFile(join(left, "a.md"), "left-only", "utf8");
  log.info("[e2e] 软删除用例启动");

  /* 目录选择走系统对话框，e2e 里直接替换成固定路径 */
  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };

  await pickInto(left);
  await page.getByTitle("更改左侧目录").click();
  await pickInto(right);
  await page.getByTitle("更改右侧目录").click();

  await scanViaSettings(page);
  await expect(page.getByText("a.md", { exact: true })).toBeVisible();
  log.info("[e2e] 扫描完成，a.md 已在列表");

  await page.getByText("a.md", { exact: true }).click({ button: "right" });
  await page.getByRole("button", { name: "软删除", exact: true }).click();
  await page.getByRole("button", { name: "移入回收站" }).click();

  /* 原位置应已没有该文件 */
  await expect
    .poll(async () => {
      try {
        await readFile(join(left, "a.md"), "utf8");
        return "exists";
      } catch {
        return "gone";
      }
    })
    .toBe("gone");
  log.info("[e2e] 原位置文件已移走");

  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(page.getByText("a.md", { exact: true })).toBeVisible();
  log.info("[e2e] 回收站里能看到刚删的文件");

  await page.getByRole("button", { name: "返回", exact: true }).click();

  await scanViaSettings(page);
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  await expect(page.getByText("a.md", { exact: true })).toHaveCount(0);
  log.info("[e2e] 重扫后已删除内容不再出现");
});

test("软删除移除整行，还原后行恢复", async ({ slot }) => {
  const { page, base } = slot;
  const left = join(base, "left");

  /* 目录对已在上个用例选定，这里只补一个新文件，与回收站里的 a.md 区分 */
  await writeFile(join(left, "b.md"), "left-only", "utf8");

  await scanViaSettings(page);
  await expect(page.getByText("b.md", { exact: true })).toBeVisible();

  await page.getByText("b.md", { exact: true }).click({ button: "right" });
  await page.getByRole("button", { name: "软删除", exact: true }).click();
  await page.getByRole("button", { name: "移入回收站" }).click();

  await expect
    .poll(async () => {
      try {
        await readFile(join(left, "b.md"), "utf8");
        return "exists";
      } catch {
        return "gone";
      }
    })
    .toBe("gone");

  /* 对侧没有文件，整行应从列表移除，不留两侧都是「—」的占位行 */
  await expect(page.getByText("—", { exact: true })).toHaveCount(0);
  log.info("[e2e] 软删除后整行已移除");

  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await expect(page.getByText("b.md", { exact: true })).toBeVisible();
  log.info("[e2e] 回收站里能看到刚删的文件");

  /* 还原后主界面应按增量新增该行，不需要重新扫描 */
  await page
    .getByText("b.md", { exact: true })
    .locator("..")
    .getByRole("button", { name: "还原", exact: true })
    .click();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByText("b.md", { exact: true })).toBeVisible();
  log.info("[e2e] 还原后行已恢复");
});

test("配对行软删除只清一侧，还原后恢复配对", async ({ slot }) => {
  const { page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");

  /* 两侧同内容不同路径，扫描后是一对 moved（不受「隐藏一致」影响） */
  await mkdir(join(left, "deep"), { recursive: true });
  await writeFile(join(left, "deep", "c.md"), "paired", "utf8");
  await writeFile(join(right, "c.md"), "paired", "utf8");

  await scanViaSettings(page);
  await expect(page.getByRole("button", { name: "扫描", exact: true })).toBeVisible();
  await expect(page.getByText("deep/c.md", { exact: true })).toBeVisible();
  await expect(page.getByText("c.md", { exact: true })).toBeVisible();
  await expect(page.getByTitle("仅路径不同", { exact: true })).toHaveCount(2);

  /* 右键左侧那一行软删除 */
  await page.getByText("deep/c.md", { exact: true }).click({ button: "right" });
  await page.getByRole("button", { name: "软删除", exact: true }).click();
  await page.getByRole("button", { name: "移入回收站" }).click();

  await expect
    .poll(async () => {
      try {
        await readFile(join(left, "deep", "c.md"), "utf8");
        return "exists";
      } catch {
        return "gone";
      }
    })
    .toBe("gone");

  /* 对侧还有文件，行不能消失，只清空被删的一侧 */
  await expect(page.getByText("c.md", { exact: true })).toBeVisible();
  await expect(page.getByText("deep/c.md", { exact: true })).toHaveCount(0);
  await expect(page.getByTitle("仅右侧", { exact: true })).toHaveCount(2);
  log.info("[e2e] 配对行只清一侧");

  /* 还原后应恢复为同一行内的配对，而不是新增一条单侧行 */
  await page.getByRole("button", { name: "回收站", exact: true }).click();
  await page
    .getByText("deep/c.md", { exact: true })
    .locator("..")
    .getByRole("button", { name: "还原", exact: true })
    .click();
  await page.getByRole("button", { name: "返回", exact: true }).click();

  await expect(page.getByText("deep/c.md", { exact: true })).toBeVisible();
  await expect(page.getByTitle("仅路径不同", { exact: true })).toHaveCount(2);
  log.info("[e2e] 还原后恢复配对");
});
