import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScanRequest } from "../src/lib/types";
import { expect, test } from "./fixtures";
import { log } from "./e2e-logger";

test("扫描后按结构对齐把文件移到对侧路径", async ({ slot }) => {
  const { page, base } = slot;
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(join(left, "deep"), { recursive: true });
  await mkdir(right, { recursive: true });
  await writeFile(join(left, "deep", "notes.md"), "hello", "utf8");
  await writeFile(join(right, "notes.md"), "hello", "utf8");
  log.info(`[e2e] 临时目录 left=${left} right=${right}`);

  const request: ScanRequest = {
    leftRoot: left,
    rightRoot: right,
    minSize: 0,
    maxSize: 0,
    maxDepth: 0,
    excludePaths: [],
    excludeNames: [],
    modifiedAfter: 0,
    modifiedBefore: 0,
    skipHidden: false,
    includeExts: [],
    excludeExts: [],
    forceRehash: false,
  };

  const outcome = await page.evaluate((input: ScanRequest) => window.api.scan(input), request);
  expect(outcome.cancelled).toBe(false);
  const scanned = outcome.result;
  expect(scanned?.rows).toHaveLength(1);
  expect(scanned?.rows[0]?.status).toBe("moved");
  log.info(`[e2e] 扫描完成 rows=${scanned?.rows.length} status=${scanned?.rows[0]?.status}`);

  // 动作由界面现算，这里直接给出一条等价的重排动作
  const actions = [
    {
      kind: "move" as const,
      side: "left" as const,
      fromPath: "deep/notes.md",
      toPath: "notes.md",
      status: "moved" as const,
      rowIndex: 0,
    },
  ];

  const executed = await page.evaluate(
    (input: { leftRoot: string; rightRoot: string; actions: typeof actions }) =>
      window.api.execute(input),
    { leftRoot: left, rightRoot: right, actions },
  );
  expect(executed.moved).toBe(1);
  expect(executed.failed).toHaveLength(0);
  log.info(`[e2e] 执行完成 moved=${executed.moved} failed=${executed.failed.length}`);
  expect(await readFile(join(left, "notes.md"), "utf8")).toBe("hello");
});
