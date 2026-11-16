import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScanRequest } from "../src/lib/types";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("扫描成功后目录对进入最近列表，重启后自动回填", async ({ slot }) => {
  const { app, page, base, appData } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  await writeFile(join(left, "a.md"), "same", "utf8");
  await writeFile(join(right, "a.md"), "same", "utf8");

  const request: ScanRequest = {
    leftRoot: left,
    rightRoot: right,
    minSize: 0,
    includeExts: [],
    excludeExts: [],
    forceRehash: false,
  };
  const outcome = await page.evaluate((input: ScanRequest) => window.api.scan(input), request);
  expect(outcome.cancelled).toBe(false);

  const saved = JSON.parse(await readFile(join(appData, "recent-pairs.json"), "utf8")) as unknown[];
  expect(saved).toHaveLength(1);
  log.info(`[e2e] 最近目录对已落盘 ${saved.length} 组`);

  const recentLabels = await app.evaluate(({ Menu }) => {
    const fileMenu = Menu.getApplicationMenu()?.items.find((item) => item.label === "文件");
    const recentMenu = fileMenu?.submenu?.items.find((item) => item.label === "最近目录对");
    return recentMenu?.submenu?.items.map((item) => item.label) ?? [];
  });
  expect(recentLabels.length).toBe(1);
  expect(recentLabels[0]).toContain("left");
  log.info(`[e2e] 菜单项 ${recentLabels[0]}`);

  await slot.relaunch();
  log.info("[e2e] 已重启应用");

  await expect(slot.page.getByRole("button", { name: left })).toBeVisible();
  await expect(slot.page.getByRole("button", { name: right })).toBeVisible();
  log.info("[e2e] 重启后目录已回填");
});
