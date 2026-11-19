import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ScanRequest } from "../src/lib/types";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("扫描成功后目录对进入最近列表，重启后自动回填", async ({ slot }) => {
  const { page, base, appData } = slot;
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
    maxSize: 0,
    maxDepth: 0,
    includeKeyword: "",
    excludeKeyword: "",
    modifiedAfter: 0,
    modifiedBefore: 0,
    skipHidden: false,
    includeExts: [],
    excludeExts: [],
    forceRehash: false,
  };
  const outcome = await page.evaluate((input: ScanRequest) => window.api.scan(input), request);
  expect(outcome.cancelled).toBe(false);

  const db = new DatabaseSync(join(appData, "dsync-main.db"));
  try {
    const rows = db.prepare("SELECT pair_key FROM dir_pairs").all() as unknown as unknown[];
    expect(rows).toHaveLength(1);
    log.info(`[e2e] 目录对档案已落盘 ${rows.length} 组`);
  } finally {
    db.close();
  }

  await slot.relaunch();
  log.info("[e2e] 已重启应用");

  /* 重启后落在扫描设置页，先返回主界面再验证表头回填 */
  await slot.page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(slot.page.getByText(left, { exact: true })).toBeVisible();
  await expect(slot.page.getByText(right, { exact: true })).toBeVisible();
  log.info("[e2e] 重启后目录已回填");
});
