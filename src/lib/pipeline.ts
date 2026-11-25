import { RateTracker, ScanCancelledError, ScanController } from "./controller";
import { hashFile, HASH_CONCURRENCY, mapLimit, type HashFileOptions } from "./hash";
import { cacheFromIndex, collectInherited, loadIndexPair, writeIndex } from "./index-file";
import { pairFiles } from "./pair";
import { assertValidRootPair, resolveInsideRoot } from "./path-guard";
import { planSync } from "./plan";
import { collectFiles, countFiles, normalizeExts, type IgnoredFile } from "./scan";
import type {
  FileEntry,
  FileStat,
  FilterOptions,
  HashCache,
  RelPath,
  ScanProgress,
  ScanRequest,
  ScanResult,
} from "./types";

export interface ScanHooks {
  onProgress?: (progress: ScanProgress) => void;
  /** 外部注入的中断控制器；不传则本次扫描不可暂停 */
  controller?: ScanController;
  /** 哈希实现：桌面端注入 worker 池，默认本地 hashFile */
  hashFn?: (fullPath: string, options?: HashFileOptions) => Promise<string>;
  /** 哈希并发数；默认 HASH_CONCURRENCY */
  hashConcurrency?: number;
}

interface HashSideOutcome {
  entries: Map<RelPath, FileEntry>;
  failed: IgnoredFile[];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** 按 500ms 节流，避免十万级文件把 IPC 打满；与执行进度保持一致 */
function createEmitter(hooks: ScanHooks): (progress: ScanProgress, force?: boolean) => void {
  let lastAt = 0;
  return (progress, force = false) => {
    const now = Date.now();
    if (!force && now - lastAt < 500) return;
    lastAt = now;
    hooks.onProgress?.(progress);
  };
}

interface CacheSplit {
  cached: Map<RelPath, FileEntry>;
  pending: FileStat[];
  /** 真正需要读取的字节数，作为哈希进度的分母 */
  bytes: number;
}

/** 预筛：缓存命中的直接出结果，其余计入待读；缓存命中不算工作量 */
function splitCache(
  files: Map<RelPath, FileStat>,
  cache: Map<RelPath, HashCache>,
  forceRehash: boolean,
): CacheSplit {
  const cached = new Map<RelPath, FileEntry>();
  const pending: FileStat[] = [];
  let bytes = 0;

  for (const file of files.values()) {
    const hit = forceRehash ? undefined : cache.get(file.path);
    if (hit && hit.size === file.size && hit.mtimeMs === file.mtimeMs) {
      cached.set(file.path, { ...file, hash: hit.hash });
      continue;
    }
    pending.push(file);
    bytes += file.size;
  }

  return { cached, pending, bytes };
}

interface HashInput {
  root: string;
  split: CacheSplit;
  controller: ScanController;
  onBytes: (delta: number) => void;
  hashFn: (fullPath: string, options?: HashFileOptions) => Promise<string>;
  concurrency: number;
}

async function hashPending(input: HashInput): Promise<HashSideOutcome> {
  const { root, split, controller, onBytes, hashFn, concurrency } = input;
  const entries = new Map(split.cached);
  const failed: IgnoredFile[] = [];

  await mapLimit(split.pending, concurrency, async (file) => {
    for (;;) {
      if (controller.cancelled) throw new ScanCancelledError();
      await controller.waitIfPaused();
      if (controller.cancelled) throw new ScanCancelledError();

      let attemptBytes = 0;
      try {
        const hash = await hashFn(resolveInsideRoot(root, file.path), {
          signal: controller.signal,
          onChunk: (size) => {
            attemptBytes += size;
            onBytes(size);
          },
        });
        entries.set(file.path, { ...file, hash });
        return;
      } catch (error) {
        if (isAbortError(error) && !controller.cancelled) {
          // 暂停中断：回滚本次已读字节，恢复后从头重读这个文件
          onBytes(-attemptBytes);
          continue;
        }
        failed.push({
          path: file.path,
          reason: "unreadable",
          size: file.size,
          mtimeMs: file.mtimeMs,
        });
        return;
      }
    }
  });

  return {
    entries: new Map([...entries.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))),
    failed,
  };
}

/** 扫描 → 哈希 → 配对 → 出计划 → 索引落盘 */
export async function runScan(request: ScanRequest, hooks: ScanHooks = {}): Promise<ScanResult> {
  assertValidRootPair(request.leftRoot, request.rightRoot);

  const controller = hooks.controller ?? new ScanController();
  const emit = createEmitter(hooks);

  const filters: FilterOptions = {
    minSize: Math.max(0, Number.isFinite(request.minSize) ? request.minSize : 0),
    maxSize: Math.max(0, Number.isFinite(request.maxSize) ? request.maxSize : 0),
    maxDepth: Math.max(0, Math.floor(Number.isFinite(request.maxDepth) ? request.maxDepth : 0)),
    includeKeyword:
      typeof request.includeKeyword === "string" ? request.includeKeyword.trim().toLowerCase() : "",
    excludeKeyword:
      typeof request.excludeKeyword === "string" ? request.excludeKeyword.trim().toLowerCase() : "",
    modifiedAfter: Math.max(0, Number.isFinite(request.modifiedAfter) ? request.modifiedAfter : 0),
    modifiedBefore: Math.max(
      0,
      Number.isFinite(request.modifiedBefore) ? request.modifiedBefore : 0,
    ),
    skipHidden: request.skipHidden !== false,
    includeExts: normalizeExts(request.includeExts),
    excludeExts: normalizeExts(request.excludeExts),
  };

  // 第一遍：两侧并行数文件，给扫描阶段一个真实分母
  let discoveredLeft = 0;
  let discoveredRight = 0;
  const emitDiscover = (): void => {
    emit({
      phase: "scan",
      done: 0,
      total: 0,
      current: "",
      discovered: discoveredLeft + discoveredRight,
    });
  };

  const [leftCount, rightCount] = await Promise.all([
    countFiles(
      request.leftRoot,
      filters,
      (found) => {
        discoveredLeft = found;
        emitDiscover();
      },
      controller,
    ),
    countFiles(
      request.rightRoot,
      filters,
      (found) => {
        discoveredRight = found;
        emitDiscover();
      },
      controller,
    ),
  ]);

  // 第二遍：逐个读取元信息并过滤
  const scanTotal = leftCount + rightCount;
  let scanned = 0;
  const onFile = (): void => {
    scanned += 1;
    emit({ phase: "scan", done: scanned, total: scanTotal, current: "" });
  };

  const [leftScan, rightScan] = await Promise.all([
    collectFiles(request.leftRoot, filters, onFile, controller),
    collectFiles(request.rightRoot, filters, onFile, controller),
  ]);

  const loaded = await loadIndexPair(request.leftRoot, request.rightRoot);
  const inherited = await collectInherited(request.leftRoot, request.rightRoot, [
    ...leftScan.nestedIndexDirs.map((dir) => ({ root: request.leftRoot, dir })),
    ...rightScan.nestedIndexDirs.map((dir) => ({ root: request.rightRoot, dir })),
  ]);
  // 索引只提供哈希缓存；配对每次现算，不读回历史配对。
  // 合并按路径生效：继承的排前、当前根排后，同名 relPath 由当前根覆盖继承值。
  const cacheData = { ...loaded.data, pairs: [...inherited.pairs, ...loaded.data.pairs] };

  // 哈希：先预筛，再按字节推进
  const leftSplit = splitCache(
    leftScan.files,
    cacheFromIndex(cacheData, "left"),
    request.forceRehash,
  );
  const rightSplit = splitCache(
    rightScan.files,
    cacheFromIndex(cacheData, "right"),
    request.forceRehash,
  );
  const hashTotal = leftSplit.bytes + rightSplit.bytes;

  let hashDone = 0;
  let lastResume = controller.resumeCount;
  const tracker = new RateTracker();
  const emitHash = (force = false): void => {
    tracker.record(hashDone);
    emit(
      {
        phase: "hash",
        done: hashDone,
        total: hashTotal,
        current: "",
        etaSeconds: tracker.eta(hashTotal),
      },
      force,
    );
  };

  const onBytes = (delta: number): void => {
    // 恢复后清空速度窗口，避免把暂停时长算进去
    if (controller.resumeCount !== lastResume) {
      lastResume = controller.resumeCount;
      tracker.reset();
    }
    hashDone += delta;
    emitHash();
  };

  emitHash(true);

  const leftHashed = await hashPending({
    root: request.leftRoot,
    split: leftSplit,
    controller,
    onBytes,
    hashFn: hooks.hashFn ?? hashFile,
    concurrency: Math.max(1, hooks.hashConcurrency ?? HASH_CONCURRENCY),
  });
  const rightHashed = await hashPending({
    root: request.rightRoot,
    split: rightSplit,
    controller,
    onBytes,
    hashFn: hooks.hashFn ?? hashFile,
    concurrency: Math.max(1, hooks.hashConcurrency ?? HASH_CONCURRENCY),
  });

  if (controller.cancelled) throw new ScanCancelledError();

  emit({ phase: "pair", done: 0, total: 1, current: "" }, true);
  const pairing = pairFiles(leftHashed.entries, rightHashed.entries);

  const leftIgnored = [...leftScan.ignored, ...leftHashed.failed];
  const rightIgnored = [...rightScan.ignored, ...rightHashed.failed];

  const plan = planSync({
    pairs: pairing.pairs,
    left: leftHashed.entries,
    right: rightHashed.entries,
    leftOnly: pairing.leftOnly,
    rightOnly: pairing.rightOnly,
    leftIgnored,
    rightIgnored,
  });

  emit({ phase: "index", done: 0, total: 1, current: "" }, true);
  const nextIndex = {
    ...loaded.data,
    updatedAt: new Date().toISOString(),
    pairs: pairing.pairs,
  };
  await Promise.all([
    writeIndex(request.leftRoot, nextIndex),
    writeIndex(request.rightRoot, nextIndex),
  ]);

  return {
    rows: plan.rows,
    stats: plan.stats,
    warnings: [...loaded.warnings, ...inherited.warnings],
  };
}
