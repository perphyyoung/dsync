import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import type { ScanRequest } from "../src/lib/types";

function launchEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  /* 防止外部环境把 e2e 当成 dev 启动 */
  delete env["ELECTRON_RENDERER_URL"];
  return { ...env, ...extra };
}

test("应用可以启动并显示左右双栏与操作栏", async () => {
  const base = await mkdtemp(join(tmpdir(), "dsync-shell-"));
  const appData = join(base, "appdata");
  await mkdir(appData, { recursive: true });

  const app = await electron.launch({ args: ["."], env: launchEnv({ DSYNC_DATA_DIR: appData }) });
  const page = await app.firstWindow();

  await expect(page.getByText("左侧目录")).toBeVisible();
  await expect(page.getByText("右侧目录")).toBeVisible();
  await expect(page.getByText("左侧文件")).toBeVisible();
  await expect(page.getByText("右侧文件")).toBeVisible();
  await expect(page.getByText("操作", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "扫描" })).toBeVisible();
  await expect(page.getByText("批量执行", { exact: false })).toBeVisible();

  const menu = await app.evaluate(({ Menu }) =>
    (Menu.getApplicationMenu()?.items ?? []).map((item) => item.label),
  );
  expect(menu).toContain("文件");

  await app.close();
  await rm(base, { recursive: true, force: true });
});

test("通过 IPC 扫描真实目录并完成结构对齐", async () => {
  const base = await mkdtemp(join(tmpdir(), "dsync-e2e-"));
  const appData = join(base, "appdata");
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(appData, { recursive: true });
  await mkdir(join(left, "deep"), { recursive: true });
  await mkdir(right, { recursive: true });
  await writeFile(join(left, "deep", "notes.md"), "hello", "utf8");
  await writeFile(join(right, "notes.md"), "hello", "utf8");

  const app = await electron.launch({ args: ["."], env: launchEnv({ DSYNC_DATA_DIR: appData }) });
  const page = await app.firstWindow();

  const request: ScanRequest = {
    leftRoot: left,
    rightRoot: right,
    minSize: 0,
    includeExts: [],
    excludeExts: [],
    direction: "none",
    align: "align-right",
    ignoreCache: false,
  };

  const scanned = await page.evaluate((input: ScanRequest) => window.api.scan(input), request);
  expect(scanned.rows).toHaveLength(1);
  expect(scanned.rows[0].status).toBe("moved");
  expect(scanned.actions).toHaveLength(1);

  const executed = await page.evaluate(
    (input: { leftRoot: string; rightRoot: string; actions: typeof scanned.actions }) =>
      window.api.execute(input),
    { leftRoot: left, rightRoot: right, actions: scanned.actions },
  );
  expect(executed.moved).toBe(1);
  expect(executed.failed).toHaveLength(0);
  expect(await readFile(join(left, "notes.md"), "utf8")).toBe("hello");

  // 扫描成功后目录对进入最近列表，菜单应能看到
  const saved = JSON.parse(await readFile(join(appData, "recent-pairs.json"), "utf8")) as unknown[];
  expect(saved).toHaveLength(1);

  const recentLabels = await app.evaluate(({ Menu }) => {
    const fileMenu = Menu.getApplicationMenu()?.items.find((item) => item.label === "文件");
    const recentMenu = fileMenu?.submenu?.items.find((item) => item.label === "最近目录对");
    return recentMenu?.submenu?.items.map((item) => item.label) ?? [];
  });
  expect(recentLabels.length).toBe(1);
  expect(recentLabels[0]).toContain("left");

  // 重启后应自动回填上次的目录对，无需重新选择
  await app.close();
  const restarted = await electron.launch({
    args: ["."],
    env: launchEnv({ DSYNC_DATA_DIR: appData }),
  });
  const page2 = await restarted.firstWindow();
  await expect(page2.getByRole("button", { name: left })).toBeVisible();
  await expect(page2.getByRole("button", { name: right })).toBeVisible();
  await restarted.close();

  await rm(base, { recursive: true, force: true });
});
