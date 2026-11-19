import { copyFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { ExecutionCancelledError, type ExecutionController } from "./execute-controller";
import { RateTracker } from "./controller";
import { PARALLEL_COPY_THRESHOLD, copyParallel } from "./copy-parallel";
import type { DiskKind } from "./disk-type";
import { hashFile } from "./hash";
import { resolveInsideRoot } from "./path-guard";
import { TMP_SUFFIX } from "./scan";
import type {
  ExecuteProgress,
  ExecuteRequest,
  ExecuteResult,
  RelPath,
  Side,
  SyncAction,
} from "./types";

export interface ExecuteDeps {
  /** 软删除：桌面端移入内置回收站，测试注入假实现 */
  softDelete: (root: string, relPath: RelPath) => Promise<void>;
  /** 哈希实现：桌面端注入 worker 池，默认本地 hashFile */
  hash?: (fullPath: string) => Promise<string>;
  /** 单文件并行分块数；默认 1（顺序） */
  copyThreads?: number;
  /** 多文件并行数；默认 1（顺序） */
  parallelFiles?: number;
  /** 磁盘类型探测：默认 unknown（按机械盘处理） */
  diskKind?: (root: string) => Promise<DiskKind>;
}

export interface ExecuteHooks {
  controller?: ExecutionController;
  onProgress?: (progress: ExecuteProgress) => void;
}

/** 复制后校验：源与目标哈希一致才算成功 */
export async function filesMatch(
  source: string,
  target: string,
  hash: (path: string) => Promise<string> = hashFile,
): Promise<boolean> {
  const sourceHash = await hash(source);
  const targetHash = await hash(target);
  return sourceHash === targetHash;
}

/** 文件大小不足阈值时直接 copyFile，不值得分块与续传 */
export const STREAM_COPY_THRESHOLD = 4 * 1024 * 1024;
/** 分块大小：暂停/取消响应与吞吐的折中 */
export const COPY_CHUNK_SIZE = 1024 * 1024;

interface CopyContext {
  controller?: ExecutionController;
  /** 哈希实现：默认本地 hashFile */
  hash?: (path: string) => Promise<string>;
  /** 动作源文件大小；由 executeActions 提前 stat，避免重复 */
  expectedSize?: number;
  /** 单文件并行分块数；1 表示顺序 */
  parallelConcurrency?: number;
  /** done / total 为字节；bytesPerSecond 为字节/秒，etaSeconds 为剩余秒数 */
  onBytes?: (
    done: number,
    total: number,
    bytesPerSecond: number,
    etaSeconds: number | null,
  ) => void;
  /** 扫描时的源哈希：有值则只校验 tmp，不重读源 */
  sourceHash?: string | null;
}

/** 分块复制：块边界检查暂停/取消；暂停保留句柄与偏移，继续即续写 */
async function copyInChunks(
  source: string,
  target: string,
  size: number,
  startOffset: number,
  ctx: CopyContext,
): Promise<void> {
  const src = await open(source, "r");
  const dst = await open(target, startOffset > 0 ? "r+" : "w");
  const buffer = Buffer.alloc(COPY_CHUNK_SIZE);
  let offset = startOffset;
  const rateStart = Date.now();
  let rateBytes = 0;
  /* 速度 / ETA 用 3 秒窗口；暂停恢复或限速变化后清空，避免把停顿算进速度 */
  const tracker = new RateTracker();
  tracker.record(startOffset);
  let lastResume = ctx.controller?.resumeCount ?? 0;
  let lastRateLimit = ctx.controller?.rateLimitBytesPerSec ?? 0;
  try {
    while (offset < size) {
      await ctx.controller?.waitIfPaused();
      ctx.controller?.throwIfCancelled();

      if (ctx.controller) {
        if (
          ctx.controller.resumeCount !== lastResume ||
          ctx.controller.rateLimitBytesPerSec !== lastRateLimit
        ) {
          lastResume = ctx.controller.resumeCount;
          lastRateLimit = ctx.controller.rateLimitBytesPerSec;
          tracker.reset();
          tracker.record(offset);
        }
      }

      const { bytesRead } = await src.read(buffer, 0, COPY_CHUNK_SIZE, offset);
      if (bytesRead === 0) break;
      await dst.write(buffer, 0, bytesRead, offset);
      offset += bytesRead;
      rateBytes += bytesRead;
      tracker.record(offset);
      ctx.onBytes?.(offset, size, tracker.rate() ?? 0, tracker.eta(size));

      /* 限速：按总字节与目标速率补齐等待，块粒度 1MB，取消响应 <= 1 块耗时 */
      const rate = ctx.controller?.rateLimitBytesPerSec ?? 0;
      if (rate > 0) {
        const targetMs = (rateBytes / rate) * 1000;
        const elapsed = Date.now() - rateStart;
        if (targetMs > elapsed) {
          await new Promise((resolve) => setTimeout(resolve, targetMs - elapsed));
        }
      }
    }
  } finally {
    await src.close();
    await dst.close();
  }
}

async function copyAtomic(
  source: string,
  target: string,
  ctx: CopyContext,
): Promise<{
  hash: string;
  size: number;
  mtimeMs: number;
}> {
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}${TMP_SUFFIX}`;
  const info = ctx.expectedSize !== undefined ? { size: ctx.expectedSize } : await stat(source);
  const parallel =
    info.size >= PARALLEL_COPY_THRESHOLD && Math.max(1, ctx.parallelConcurrency ?? 1) > 1;

  /* 顺序模式大文件优先续传；并行模式写是乱序的，不复用半成品 */
  let startOffset = 0;
  const partial = await stat(tmp).catch(() => null);
  if (
    !parallel &&
    info.size >= STREAM_COPY_THRESHOLD &&
    partial &&
    partial.size > 0 &&
    partial.size < info.size
  ) {
    startOffset = partial.size;
  } else if (partial) {
    await rm(tmp, { force: true }).catch(() => {});
  }

  try {
    if (info.size < STREAM_COPY_THRESHOLD) {
      ctx.controller?.throwIfCancelled();
      await copyFile(source, tmp);
    } else if (parallel) {
      await copyParallel({
        source,
        target: tmp,
        size: info.size,
        concurrency: Math.max(1, ctx.parallelConcurrency ?? 1),
        controller: ctx.controller,
        onBytes: ctx.onBytes,
      });
    } else {
      await copyInChunks(source, tmp, info.size, startOffset, ctx);
    }
    /* 校验：优先用扫描哈希比对 tmp（不重读源），无哈希时回退源/目标全量比对 */
    const hash = ctx.hash ?? hashFile;
    let verified: string;
    if (ctx.sourceHash) {
      verified = await hash(tmp);
      if (verified !== ctx.sourceHash) {
        throw new Error("校验失败：复制内容与扫描记录不一致");
      }
    } else {
      const sourceHash = await hash(source);
      verified = await hash(tmp);
      if (sourceHash !== verified) {
        throw new Error("校验失败：复制内容与源不一致");
      }
    }
    await rename(tmp, target);
    const targetInfo = await stat(target).catch(() => null);
    return {
      hash: verified,
      size: targetInfo?.size ?? info.size,
      mtimeMs: targetInfo ? Math.floor(targetInfo.mtimeMs) : 0,
    };
  } catch (error) {
    /* 取消：顺序模式保留半成品续传；并行模式乱序，删除半成品 */
    if (!(error instanceof ExecutionCancelledError) || parallel) {
      await rm(tmp, { force: true }).catch(() => {});
    }
    throw error;
  }
}

export async function executeActions(
  request: ExecuteRequest,
  deps: ExecuteDeps,
  hooks: ExecuteHooks = {},
): Promise<ExecuteResult> {
  const rootOf = (side: Side): string => (side === "left" ? request.leftRoot : request.rightRoot);
  const result: ExecuteResult = {
    copied: 0,
    moved: 0,
    deleted: 0,
    failed: [],
    moves: [],
    copies: [],
    stale: [],
    cancelled: false,
  };
  const actions = request.actions;
  const total = actions.length;
  const controller = hooks.controller;
  const kindCache = new Map<string, Promise<DiskKind>>();
  const kindOf = (root: string): Promise<DiskKind> => {
    const cached = kindCache.get(root);
    if (cached) return cached;
    const pending = (deps.diskKind?.(root) ?? Promise.resolve<DiskKind>("unknown")).catch(
      () => "unknown" as DiskKind,
    );
    kindCache.set(root, pending);
    return pending;
  };

  /* 扫描大小优先；缺失时补一次 stat，用于总字节与排序 */
  const sizes = new Map<number, number>();
  let totalBytes = 0;
  for (const [index, action] of actions.entries()) {
    if (action.kind !== "copy") continue;
    const sourceRoot = rootOf(action.side === "left" ? "right" : "left");
    const sourceFull = resolveInsideRoot(sourceRoot, action.fromPath ?? action.toPath);
    const size =
      typeof action.sizeBytes === "number"
        ? action.sizeBytes
        : await stat(sourceFull).then(
            (info) => info.size,
            () => 0,
          );
    sizes.set(index, size);
    totalBytes += size;
  }

  /* 多文件并发：SSD 用设置值；机械/未知最多 2；网络最多 4 */
  let fileConcurrency = Math.max(1, Math.floor(deps.parallelFiles ?? 1));
  if (fileConcurrency > 1 && actions.some((action) => action.kind === "copy")) {
    const [leftKind, rightKind] = await Promise.all([
      kindOf(request.leftRoot),
      kindOf(request.rightRoot),
    ]);
    if (
      leftKind === "hdd" ||
      rightKind === "hdd" ||
      leftKind === "unknown" ||
      rightKind === "unknown"
    ) {
      fileConcurrency = Math.min(fileConcurrency, 2);
    } else if (leftKind === "network" || rightKind === "network") {
      fileConcurrency = Math.min(fileConcurrency, 4);
    }
  }

  const tracker = new RateTracker();
  tracker.record(0);
  const activeBytes = new Map<number, number>();
  let completedBytes = 0;
  let completed = 0;
  let activeFiles = 0;
  let cancelled = false;

  const aggregateDone = (): number => {
    let sum = completedBytes;
    for (const bytes of activeBytes.values()) sum += bytes;
    return sum;
  };

  const emitProgress = (
    currentPath: string,
    fileDone = 0,
    fileTotal = 0,
    bytesPerSecond = 0,
    etaSeconds: number | null = null,
  ): void => {
    hooks.onProgress?.({
      done: completed,
      total,
      currentPath,
      fileBytesDone: fileDone,
      fileBytesTotal: fileTotal,
      bytesPerSecond,
      etaSeconds,
      bytesDone: aggregateDone(),
      bytesTotal: totalBytes,
      activeFiles,
    });
  };

  const runCopy = async (index: number, action: SyncAction): Promise<void> => {
    const targetRoot = rootOf(action.side);
    const targetFull = resolveInsideRoot(targetRoot, action.toPath);
    const sourceRoot = rootOf(action.side === "left" ? "right" : "left");
    const sourceFull = resolveInsideRoot(sourceRoot, action.fromPath ?? action.toPath);

    let sourceSize: number;
    let sourceMtimeMs: number;
    try {
      const info = await stat(sourceFull);
      sourceSize = info.size;
      sourceMtimeMs = Math.floor(info.mtimeMs);
    } catch (error) {
      result.failed.push({ path: action.toPath, message: (error as Error).message });
      completed += 1;
      emitProgress(action.toPath);
      return;
    }

    activeBytes.set(index, 0);
    activeFiles = activeBytes.size;
    emitProgress(action.toPath, 0, sourceSize);

    /* 单文件并行：只在两侧都确认 SSD 且文件够大时启用；未知/机械/网络一律顺序 */
    let parallelConcurrency = 1;
    if (sourceSize >= PARALLEL_COPY_THRESHOLD && (deps.copyThreads ?? 1) > 1) {
      const [sourceKind, targetKind] = await Promise.all([kindOf(sourceRoot), kindOf(targetRoot)]);
      if (sourceKind === "ssd" && targetKind === "ssd") {
        parallelConcurrency = Math.max(1, Math.floor(deps.copyThreads ?? 1));
      }
    }

    try {
      const copy = await copyAtomic(sourceFull, targetFull, {
        controller,
        hash: deps.hash,
        expectedSize: sourceSize,
        parallelConcurrency,
        sourceHash: typeof action.sourceHash === "string" ? action.sourceHash : null,
        onBytes: (done, bytesTotal) => {
          activeBytes.set(index, done);
          tracker.record(aggregateDone());
          emitProgress(
            action.toPath,
            done,
            bytesTotal,
            tracker.rate() ?? 0,
            totalBytes > 0 ? tracker.eta(totalBytes) : null,
          );
        },
      });
      completedBytes += sourceSize;
      result.copied += 1;
      result.copies.push({
        side: action.side,
        from: action.fromPath ?? action.toPath,
        to: action.toPath,
        hash: copy.hash,
        size: copy.size,
        mtimeMs: copy.mtimeMs,
        sourceMtimeMs,
      });
    } catch (error) {
      if (error instanceof ExecutionCancelledError) {
        cancelled = true;
      } else {
        result.failed.push({ path: action.toPath, message: (error as Error).message });
      }
    } finally {
      activeBytes.delete(index);
      activeFiles = activeBytes.size;
    }

    if (!cancelled) {
      completed += 1;
      tracker.record(aggregateDone());
      emitProgress(action.toPath);
    }
  };

  const runSerial = async (action: SyncAction): Promise<void> => {
    const targetRoot = rootOf(action.side);
    const targetFull = resolveInsideRoot(targetRoot, action.toPath);
    emitProgress(action.toPath);

    try {
      if (action.kind === "move") {
        const from = action.fromPath ?? action.toPath;
        const sourceFull = resolveInsideRoot(targetRoot, from);
        await mkdir(dirname(targetFull), { recursive: true });
        await rename(sourceFull, targetFull);
        result.moved += 1;
        result.moves.push({ side: action.side, from, to: action.toPath });
      } else {
        await deps.softDelete(targetRoot, action.toPath);
        result.deleted += 1;
      }
    } catch (error) {
      if (error instanceof ExecutionCancelledError) {
        cancelled = true;
        return;
      }
      result.failed.push({ path: action.toPath, message: (error as Error).message });
    }

    completed += 1;
    tracker.record(aggregateDone());
    emitProgress(action.toPath);
  };

  const active = new Set<Promise<void>>();
  const startCopy = (index: number, action: SyncAction): void => {
    let task: Promise<void>;
    task = runCopy(index, action).finally(() => {
      active.delete(task);
    });
    active.add(task);
  };

  let fatal: unknown = null;
  try {
    let index = 0;
    while (index < actions.length) {
      if (cancelled || controller?.cancelled) break;
      await controller?.waitIfPaused();
      controller?.throwIfCancelled();

      const action = actions[index];
      if (action.kind !== "copy") {
        await Promise.all(active);
        if (cancelled || controller?.cancelled) break;
        await runSerial(action);
        index += 1;
        continue;
      }

      /* 大文件单独跑 P3 分块，避免与多文件并行叠加；小文件进并发窗口 */
      if ((sizes.get(index) ?? 0) >= PARALLEL_COPY_THRESHOLD) {
        await Promise.all(active);
        if (cancelled || controller?.cancelled) break;
        await runCopy(index, action);
        index += 1;
        continue;
      }

      if (active.size >= fileConcurrency) {
        await Promise.race(active);
        continue;
      }
      startCopy(index, action);
      index += 1;
    }
  } catch (error) {
    if (error instanceof ExecutionCancelledError) cancelled = true;
    else fatal = error;
  }

  await Promise.all(active);
  result.cancelled = cancelled || controller?.cancelled === true;
  if (fatal) throw fatal;
  return result;
}
