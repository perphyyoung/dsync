import { copyFile, mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { ExecutionCancelledError, type ExecutionController } from "./execute-controller";
import { hashFile } from "./hash";
import { resolveInsideRoot } from "./path-guard";
import { TMP_SUFFIX } from "./scan";
import type { ExecuteProgress, ExecuteRequest, ExecuteResult, RelPath, Side } from "./types";

export interface ExecuteDeps {
  /** 软删除：桌面端移入内置回收站，测试注入假实现 */
  softDelete: (root: string, relPath: RelPath) => Promise<void>;
}

export interface ExecuteHooks {
  controller?: ExecutionController;
  onProgress?: (progress: ExecuteProgress) => void;
}

/** 复制后校验：源与目标哈希一致才算成功 */
export async function filesMatch(source: string, target: string): Promise<boolean> {
  const sourceHash = await hashFile(source);
  const targetHash = await hashFile(target);
  return sourceHash === targetHash;
}

/** 文件大小不足阈值时直接 copyFile，不值得分块与续传 */
export const STREAM_COPY_THRESHOLD = 4 * 1024 * 1024;
/** 分块大小：暂停/取消响应与吞吐的折中 */
export const COPY_CHUNK_SIZE = 1024 * 1024;

interface CopyContext {
  controller?: ExecutionController;
  onBytes?: (done: number, total: number) => void;
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
  try {
    while (offset < size) {
      await ctx.controller?.waitIfPaused();
      ctx.controller?.throwIfCancelled();
      const { bytesRead } = await src.read(buffer, 0, COPY_CHUNK_SIZE, offset);
      if (bytesRead === 0) break;
      await dst.write(buffer, 0, bytesRead, offset);
      offset += bytesRead;
      ctx.onBytes?.(offset, size);
    }
  } finally {
    await src.close();
    await dst.close();
  }
}

async function copyAtomic(source: string, target: string, ctx: CopyContext): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}${TMP_SUFFIX}`;
  const info = await stat(source);

  /* 大文件优先续传：上次取消留下的半成品已写入的部分直接跳过 */
  let startOffset = 0;
  const partial = await stat(tmp).catch(() => null);
  if (
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
    } else {
      await copyInChunks(source, tmp, info.size, startOffset, ctx);
    }
    /* 校验：优先用扫描哈希比对 tmp（不重读源），无哈希时回退源/目标全量比对 */
    const expected = ctx.sourceHash;
    if (expected) {
      if ((await hashFile(tmp)) !== expected) {
        throw new Error("校验失败：复制内容与扫描记录不一致");
      }
    } else if (!(await filesMatch(source, tmp))) {
      throw new Error("校验失败：复制内容与源不一致");
    }
    await rename(tmp, target);
  } catch (error) {
    if (error instanceof ExecutionCancelledError) {
      /* 取消保留半成品用于续传；过期半成品由扫描时清理 */
    } else {
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
    stale: [],
    cancelled: false,
  };
  const total = request.actions.length;

  const emit = (done: number, currentPath: string, bytes = 0, bytesTotal = 0): void => {
    hooks.onProgress?.({
      done,
      total,
      currentPath,
      fileBytesDone: bytes,
      fileBytesTotal: bytesTotal,
    });
  };

  try {
    for (const [index, action] of request.actions.entries()) {
      await hooks.controller?.waitIfPaused();
      hooks.controller?.throwIfCancelled();
      emit(index, action.toPath);

      try {
        const targetRoot = rootOf(action.side);
        const targetFull = resolveInsideRoot(targetRoot, action.toPath);

        if (action.kind === "copy") {
          const sourceRoot = rootOf(action.side === "left" ? "right" : "left");
          const sourceFull = resolveInsideRoot(sourceRoot, action.fromPath ?? action.toPath);
          await copyAtomic(sourceFull, targetFull, {
            controller: hooks.controller,
            sourceHash: typeof action.sourceHash === "string" ? action.sourceHash : null,
            onBytes: (done, bytesTotal) => emit(index, action.toPath, done, bytesTotal),
          });
          result.copied += 1;
        } else if (action.kind === "move") {
          const from = action.fromPath ?? action.toPath;
          const sourceFull = resolveInsideRoot(targetRoot, from);
          await mkdir(dirname(targetFull), { recursive: true });
          await rename(sourceFull, targetFull);
          result.moved += 1;
          result.moves.push({ side: action.side, from, to: action.toPath });
        } else if (action.kind === "soft-delete") {
          await deps.softDelete(targetRoot, action.toPath);
          result.deleted += 1;
        }
      } catch (error) {
        if (error instanceof ExecutionCancelledError) throw error;
        result.failed.push({ path: action.toPath, message: (error as Error).message });
      }
      emit(index + 1, action.toPath);
    }
  } catch (error) {
    if (error instanceof ExecutionCancelledError) {
      result.cancelled = true;
      return result;
    }
    throw error;
  }

  return result;
}
