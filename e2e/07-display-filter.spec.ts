import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("显示过滤缩小直接刷新，扩大弹窗可还原", async ({ slot }) => {
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  await writeFile(join(left, "a.md"), "a", "utf8");
  await writeFile(join(left, "b.txt"), "b", "utf8");
  await writeFile(join(right, "c.md"), "c", "utf8");

  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };
  await pickInto(left);
  await page.getByTitle("更改左侧目录").click();
  await pickInto(right);
  await page.getByTitle("更改右侧目录").click();
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible();

  /* 缩小：只含关键字 a → 只保留 a.md，直接前端刷新 */
  const keyword = page.getByPlaceholder("输入单个词来命中");
  await keyword.fill("a");
  await expect(page.getByTitle("a.md", { exact: true })).toBeVisible();
  await expect(page.getByTitle("b.txt", { exact: true })).toHaveCount(0);
  await expect(page.getByTitle("c.md", { exact: true })).toHaveCount(0);
  await expect(page.getByText("显示条件超出扫描范围")).toHaveCount(0);
  await keyword.fill("");
  await expect(page.getByTitle("b.txt", { exact: true })).toBeVisible();

  /* 扩大：取消跳过隐藏文件，扫描却跳过了隐藏 */
  const skipHidden = page.getByLabel("跳过隐藏文件");
  await expect(skipHidden).toBeChecked();
  await skipHidden.uncheck();
  await expect(page.getByText("显示条件超出扫描范围")).toBeVisible();
  await expect(page.getByRole("button", { name: "还原修改", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新扫描" }).last()).toBeVisible();

  /* 还原修改：勾选恢复，结果保留 */
  await page.getByRole("button", { name: "还原修改", exact: true }).click();
  await expect(skipHidden).toBeChecked();
  await expect(page.getByText("显示条件超出扫描范围")).toHaveCount(0);
  await expect(page.getByTitle("a.md", { exact: true })).toBeVisible();

  /* 重置显示条件：一键恢复默认，列表恢复 */
  await page.getByPlaceholder("输入单个词来命中").fill("a");
  await expect(page.getByTitle("b.txt", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await expect(page.getByPlaceholder("输入单个词来命中")).toHaveValue("");
  await expect(page.getByTitle("b.txt", { exact: true })).toBeVisible();
  await expect(page.getByText("显示条件超出扫描范围")).toHaveCount(0);

  /* 改扫描条件不扫描：旧结果与摘要都不变；点重新扫描后作废旧结果 */
  await page.getByRole("button", { name: "重新扫描", exact: true }).click();
  await page.getByLabel("排除关键字").fill("a");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByTitle("a.md", { exact: true })).toBeVisible();
  await expect(page.getByText("无过滤条件，全量显示")).toBeVisible();
  await page.getByRole("button", { name: "重新扫描", exact: true }).click();
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible();
  await expect(page.getByTitle("a.md", { exact: true })).toHaveCount(0);
  await expect(page.getByText("排除关键字 a")).toBeVisible();
  log.info("[e2e] 改条件保留旧结果，扫描成功后才更新");
  log.info("[e2e] 显示过滤缩小即时生效，扩大弹窗可还原");
});
