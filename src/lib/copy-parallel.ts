import { open } from "node:fs/promises";
import { RateTracker } from "./controller";
import type { ExecutionController } from "./execute-controller";

/** 单文件并行复制的启用阈值：小文件不值得拆分 */
export const PARALLEL_COPY_THRESHOLD = 64 * 1024 * 1024;
/** 并行复制分块：8MB，兼顾吞吐与暂停/取消响应 */
export const PARALLEL_COPY_CHUNK = 8 * 1024 * 1024;

export interface ParallelCopyOptions {
  source: string;
  target: string;
  size: number;
  /** 并行分块数；调用方应已按磁盘类型把机械盘降为 1 */
  concurrency: number;
  controller?: ExecutionController;
  onBytes?: (
    done: number,
    total: number,
    bytesPerSecond: number,
    etaSeconds: number | null,
  ) => void;
}

/**
 * 单文件并行复制：按 8MB 范围同时读写，写到目标 tmp。
 * 取消时当前块完成后停止；半成品由调用方按并行模式规则清理。
 */
export async function copyParallel(options: ParallelCopyOptions): Promise<void> {
  const { source, target, size, controller, onBytes } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const src = await open(source, "r");
  const dst = await open(target, "w");
  const tracker = new RateTracker();
  tracker.record(0);

  const chunkCount = Math.max(1, Math.ceil(size / PARALLEL_COPY_CHUNK));
  const workers = Math.min(concurrency, chunkCount);
  let cursor = 0;
  let done = 0;
  let stopped = false;
  let failure: unknown = null;
  /* 限速按所有 worker 的累计字节计算；改速率后重新计时 */
  let rateStart = Date.now();
  let rateBytes = 0;
  let lastRate = controller?.rateLimitBytesPerSec ?? 0;

  const runWorker = async (): Promise<void> => {
    const buffer = Buffer.allocUnsafe(PARALLEL_COPY_CHUNK);
    while (!stopped) {
      try {
        await controller?.waitIfPaused();
        controller?.throwIfCancelled();
      } catch (error) {
        failure = error;
        stopped = true;
        return;
      }

      const index = cursor;
      cursor += 1;
      if (index >= chunkCount) return;

      const offset = index * PARALLEL_COPY_CHUNK;
      const length = Math.min(PARALLEL_COPY_CHUNK, size - offset);
      try {
        const { bytesRead } = await src.read(buffer, 0, length, offset);
        if (bytesRead !== length) throw new Error("读取长度不足");
        const { bytesWritten } = await dst.write(buffer, 0, bytesRead, offset);
        if (bytesWritten !== bytesRead) throw new Error("写入长度不足");

        done += bytesRead;
        tracker.record(done);
        onBytes?.(done, size, tracker.rate() ?? 0, tracker.eta(size));

        const rate = controller?.rateLimitBytesPerSec ?? 0;
        if (rate !== lastRate) {
          lastRate = rate;
          rateBytes = 0;
          rateStart = Date.now();
        }
        rateBytes += bytesRead;
        if (rate > 0) {
          const targetMs = (rateBytes / rate) * 1000;
          const elapsed = Date.now() - rateStart;
          if (targetMs > elapsed) {
            await new Promise((resolve) => setTimeout(resolve, targetMs - elapsed));
          }
        }
        controller?.throwIfCancelled();
      } catch (error) {
        failure = error;
        stopped = true;
        return;
      }
    }
  };

  try {
    await dst.truncate(size);
    await Promise.all(Array.from({ length: workers }, runWorker));
  } finally {
    await src.close().catch(() => undefined);
    await dst.close().catch(() => undefined);
  }

  if (failure) throw failure;
}
