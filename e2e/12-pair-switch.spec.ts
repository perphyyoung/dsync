import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("换目录对后摘要清空，旧索引不告警", async ({ slot }) => {
  test.setTimeout(60_000);
  const { app, page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  const other = join(base, "other");
  for (const dir of [left, right, other]) await mkdir(dir, { recursive: true });
  await writeFile(join(left, "a.md"), "a", "utf8");
  await writeFile(join(right, "b.md"), "b", "utf8");
  await writeFile(join(other, "c.md"), "c", "utf8");

  const pickInto = async (target: string): Promise<void> => {
    await app.evaluate(({ dialog }, picked) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] });
    }, target);
  };

  await pickInto(left);
  await page.getByTitle("更改左侧目录").click();
  await pickInto(right);
  await page.getByTitle("更改右侧目录").click();
  await page.getByLabel("目录层级").fill("2");
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("层级 ≤ 2")).toBeVisible();

  /* 换掉右侧目录：结果与扫描摘要都应清空 */
  await page.getByRole("button", { name: "重新扫描", exact: true }).click();
  await pickInto(other);
  await page.getByTitle("更改右侧目录").click();
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(page.getByText("层级 ≤ 2")).toHaveCount(0);
  await expect(page.getByText("无过滤条件，全量显示")).toBeVisible();

  /* 新目录对扫描：旧索引不再弹「目录与当前选择不一致」 */
  await page.getByRole("button", { name: "重新扫描", exact: true }).click();
  await page.getByRole("button", { name: "开始扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "重新扫描", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("索引记录的目录与当前选择不一致")).toHaveCount(0);

  log.info("[e2e] 换目录对后摘要清空，旧索引按侧复用且不告警");
});
