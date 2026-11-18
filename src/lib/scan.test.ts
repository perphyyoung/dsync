import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TMP_MAX_AGE_MS, cleanStaleTmp } from "./scan";

const created: string[] = [];

async function setup(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dsync-tmp-"));
  created.push(dir);
  return dir;
}

async function ageFile(full: string, ageMs: number): Promise<void> {
  const when = new Date(Date.now() - ageMs);
  await utimes(full, when, when);
}

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("过期半成品清理", () => {
  it("超过 7 天的 .dsynctmp 会被删除", async () => {
    const dir = await setup();
    const full = join(dir, "a.dsynctmp");
    await writeFile(full, "partial", "utf8");
    await ageFile(full, TMP_MAX_AGE_MS + 60_000);

    expect(await cleanStaleTmp(full)).toBe(true);
    await expect(stat(full)).rejects.toThrow();
  });

  it("7 天内的半成品保留", async () => {
    const dir = await setup();
    const full = join(dir, "b.dsynctmp");
    await writeFile(full, "partial", "utf8");
    await ageFile(full, TMP_MAX_AGE_MS - 60_000);

    expect(await cleanStaleTmp(full)).toBe(false);
    expect((await stat(full)).size).toBeGreaterThan(0);
  });

  it("文件不存在时静默返回 false", async () => {
    const dir = await setup();
    expect(await cleanStaleTmp(join(dir, "missing.dsynctmp"))).toBe(false);
  });
});
