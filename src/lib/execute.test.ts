import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COPY_CHUNK_SIZE, STREAM_COPY_THRESHOLD, executeActions } from "./execute";
import { ExecutionController } from "./execute-controller";
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

  it("取消时中断当前文件并删除半成品", async () => {
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
    expect((await readdir(right)).filter((name) => name.endsWith(TMP_SUFFIX))).toHaveLength(0);
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
