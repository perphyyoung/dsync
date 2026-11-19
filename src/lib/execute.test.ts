import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COPY_CHUNK_SIZE, STREAM_COPY_THRESHOLD, executeActions, filesMatch } from "./execute";
import { ExecutionController } from "./execute-controller";
import { hashText } from "./hash";
import { TMP_SUFFIX } from "./scan";
import type { ExecuteRequest, SyncAction } from "./types";

const created: string[] = [];

async function setup(): Promise<{ left: string; right: string }> {
  const base = await mkdtemp(join(tmpdir(), "dsync-exec-"));
  created.push(base);
  const left = join(base, "left");
  const right = join(base, "right");
  await mkdir(left, { recursive: true });
  await mkdir(right, { recursive: true });
  return { left, right };
}

const softDelete = async (): Promise<void> => {};

function copyAction(fromPath: string, toPath: string): SyncAction {
  return { kind: "copy", side: "right", fromPath, toPath, status: "left-only", rowIndex: 0 };
}

function request(left: string, right: string, actions: SyncAction[]): ExecuteRequest {
  return { leftRoot: left, rightRoot: right, actions };
}

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("执行复制", () => {
  it("小文件用 copyFile 分支，动作级进度完成", async () => {
    const { left, right } = await setup();
    await writeFile(join(left, "a.md"), "hello", "utf8");
    const progress: number[] = [];

    const result = await executeActions(
      request(left, right, [copyAction("a.md", "a.md")]),
      { softDelete },
      {
        onProgress: (next) => progress.push(next.done),
      },
    );

    expect(result.copied).toBe(1);
    expect(result.cancelled).toBe(false);
    expect(await readFile(join(right, "a.md"), "utf8")).toBe("hello");
    expect(progress.at(-1)).toBe(1);
  });

  it("大文件分块复制并上报字节进度", async () => {
    const { left, right } = await setup();
    const size = STREAM_COPY_THRESHOLD + COPY_CHUNK_SIZE * 2;
    await writeFile(join(left, "big.bin"), Buffer.alloc(size, 7));
    const bytes: { done: number; total: number }[] = [];

    const result = await executeActions(
      request(left, right, [copyAction("big.bin", "big.bin")]),
      { softDelete },
      {
        onProgress: (next) => {
          expect(next.bytesPerSecond).toBeGreaterThanOrEqual(0);
          if (next.fileBytesTotal > 0) {
            bytes.push({ done: next.fileBytesDone, total: next.fileBytesTotal });
          }
        },
      },
    );

    expect(result.copied).toBe(1);
    expect(bytes.length).toBeGreaterThan(1);
    expect(bytes[0]?.total).toBe(size);
    expect(bytes.at(-1)?.done).toBe(size);
    expect((await stat(join(right, "big.bin"))).size).toBe(size);
  });

  it("取消保留半成品，下次从断点续传完成", async () => {
    const { left, right } = await setup();
    const size = STREAM_COPY_THRESHOLD + COPY_CHUNK_SIZE * 4;
    await writeFile(join(left, "big.bin"), Buffer.alloc(size, 1));
    const controller = new ExecutionController();

    const result = await executeActions(
      request(left, right, [copyAction("big.bin", "big.bin")]),
      { softDelete },
      {
        controller,
        onProgress: (next) => {
          if (next.fileBytesDone > 0) controller.cancel();
        },
      },
    );

    expect(result.cancelled).toBe(true);
    await expect(stat(join(right, "big.bin"))).rejects.toThrow();
    /* 取消保留半成品，大小介于 0 与完整大小之间 */
    const partial = await stat(join(right, `big.bin${TMP_SUFFIX}`));
    expect(partial.size).toBeGreaterThan(0);
    expect(partial.size).toBeLessThan(size);

    /* 再次执行：从断点续写，校验通过后落地 */
    const retry = await executeActions(request(left, right, [copyAction("big.bin", "big.bin")]), {
      softDelete,
    });
    expect(retry.copied).toBe(1);
    expect((await stat(join(right, "big.bin"))).size).toBe(size);
    expect((await readdir(right)).filter((name) => name.endsWith(TMP_SUFFIX))).toHaveLength(0);
  });

  it("带扫描哈希时只校验 tmp，不一致则失败", async () => {
    const { left, right } = await setup();
    await writeFile(join(left, "a.md"), "hello", "utf8");
    const good: SyncAction = { ...copyAction("a.md", "a.md"), sourceHash: hashText("hello") };
    const ok = await executeActions(request(left, right, [good]), { softDelete });
    expect(ok.copied).toBe(1);
    expect(await readFile(join(right, "a.md"), "utf8")).toBe("hello");

    await writeFile(join(left, "b.md"), "world", "utf8");
    const bad: SyncAction = { ...copyAction("b.md", "b.md"), sourceHash: hashText("mismatch") };
    const failed = await executeActions(request(left, right, [bad]), { softDelete });
    expect(failed.copied).toBe(0);
    expect(failed.failed).toHaveLength(1);
    expect(failed.failed[0]?.message).toContain("校验失败");
    await expect(stat(join(right, "b.md"))).rejects.toThrow();
    expect((await readdir(right)).filter((name) => name.endsWith(TMP_SUFFIX))).toHaveLength(0);
  });

  it("复制后哈希校验：相同内容通过、不同内容拒绝", async () => {
    const { left, right } = await setup();
    await writeFile(join(left, "a.txt"), "same", "utf8");
    await writeFile(join(right, "a.txt"), "same", "utf8");
    await writeFile(join(right, "b.txt"), "diff", "utf8");

    expect(await filesMatch(join(left, "a.txt"), join(right, "a.txt"))).toBe(true);
    expect(await filesMatch(join(left, "a.txt"), join(right, "b.txt"))).toBe(false);
  });

  it("暂停后继续，从断点续写完成", async () => {
    const { left, right } = await setup();
    const size = STREAM_COPY_THRESHOLD + COPY_CHUNK_SIZE * 4;
    await writeFile(join(left, "big.bin"), Buffer.alloc(size, 3));
    const controller = new ExecutionController();
    let paused = false;

    const running = executeActions(
      request(left, right, [copyAction("big.bin", "big.bin")]),
      { softDelete },
      {
        controller,
        onProgress: (next) => {
          if (!paused && next.fileBytesDone > 0) {
            paused = true;
            controller.pause();
          }
        },
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(paused).toBe(true);
    /* 暂停期间目标文件尚未出现 */
    await expect(stat(join(right, "big.bin"))).rejects.toThrow();

    controller.resume();
    const result = await running;
    expect(result.copied).toBe(1);
    expect((await stat(join(right, "big.bin"))).size).toBe(size);
  });
});
