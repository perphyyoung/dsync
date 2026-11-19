import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PARALLEL_COPY_CHUNK, copyParallel } from "./copy-parallel";
import { ExecutionCancelledError, ExecutionController } from "./execute-controller";

const created: string[] = [];

async function setup(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dsync-parallel-"));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of created.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("单文件并行复制", () => {
  it("按 8MB 分块并行写入并汇总进度", async () => {
    const dir = await setup();
    const source = join(dir, "source.bin");
    const target = join(dir, "target.bin");
    const size = PARALLEL_COPY_CHUNK * 3 + 123;
    const data = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) data[i] = i % 251;
    await writeFile(source, data);

    const progress: { done: number; total: number }[] = [];
    await copyParallel({
      source,
      target,
      size,
      concurrency: 2,
      onBytes: (done, total) => progress.push({ done, total }),
    });

    expect(await readFile(target)).toEqual(data);
    expect(progress.at(-1)).toEqual({ done: size, total: size });
    expect(progress.length).toBeGreaterThan(1);
  });

  it("取消后停止并抛出 ExecutionCancelledError", async () => {
    const dir = await setup();
    const source = join(dir, "source.bin");
    const target = join(dir, "target.bin");
    const size = PARALLEL_COPY_CHUNK * 4;
    await writeFile(source, Buffer.alloc(size, 3));

    const controller = new ExecutionController();
    await expect(
      copyParallel({
        source,
        target,
        size,
        concurrency: 2,
        controller,
        onBytes: () => controller.cancel(),
      }),
    ).rejects.toBeInstanceOf(ExecutionCancelledError);
  });
});
