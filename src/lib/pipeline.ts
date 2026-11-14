import { hashFile, HASH_CONCURRENCY, mapLimit } from "./hash";
import {
  cacheFromIndex,
  collectInherited,
  loadIndexPair,
  mergePairs,
  writeIndex,
} from "./index-file";
import { pairFiles } from "./pair";
import { assertValidRootPair, resolveInsideRoot } from "./path-guard";
import { planSync } from "./plan";
import { normalizeExts, scanDirectory, type IgnoredFile } from "./scan";
import type { FileEntry, FileStat, HashCache, RelPath, ScanRequest, ScanResult } from "./types";

export interface ScanProgress {
  phase: "scan" | "hash" | "pair" | "index";
  done: number;
  total: number;
  current: string;
}

export interface ScanHooks {
  onProgress?: (progress: ScanProgress) => void;
}

interface HashSideOutcome {
  entries: Map<RelPath, FileEntry>;
  failed: IgnoredFile[];
}

async function hashSide(
  root: string,
  files: Map<RelPath, FileStat>,
  cache: Map<RelPath, HashCache>,
  ignoreCache: boolean,
  onDone: (current: string) => void,
): Promise<HashSideOutcome> {
  const list = [...files.values()];
  const entries = new Map<RelPath, FileEntry>();
  const failed: IgnoredFile[] = [];

  await mapLimit(list, HASH_CONCURRENCY, async (file) => {
    const cached = cache.get(file.path);
    try {
      const reusable =
        !ignoreCache &&
        cached !== undefined &&
        cached.size === file.size &&
        cached.mtimeMs === file.mtimeMs;
      const hash = reusable ? cached.hash : await hashFile(resolveInsideRoot(root, file.path));
      entries.set(file.path, { ...file, hash });
    } catch {
      failed.push({ path: file.path, reason: "unreadable", size: file.size });
    }
    onDone(file.path);
  });

  return {
    entries: new Map([...entries.entries()].toSorted((a, b) => a[0].localeCompare(b[0]))),
    failed,
  };
}

/** 扫描 → 哈希 → 配对 → 出计划 → 索引落盘 */
export async function runScan(request: ScanRequest, hooks: ScanHooks = {}): Promise<ScanResult> {
  assertValidRootPair(request.leftRoot, request.rightRoot);

  const filters = {
    minSize: Math.max(0, Number.isFinite(request.minSize) ? request.minSize : 0),
    includeExts: normalizeExts(request.includeExts),
    excludeExts: normalizeExts(request.excludeExts),
  };

  hooks.onProgress?.({ phase: "scan", done: 0, total: 2, current: request.leftRoot });
  const leftScan = await scanDirectory(request.leftRoot, filters);
  hooks.onProgress?.({ phase: "scan", done: 1, total: 2, current: request.rightRoot });
  const rightScan = await scanDirectory(request.rightRoot, filters);

  const loaded = await loadIndexPair(request.leftRoot, request.rightRoot);
  const inherited = await collectInherited(
    request.leftRoot,
    request.rightRoot,
    leftScan.nestedIndexDirs,
  );
  const indexPairs = mergePairs(loaded.data.pairs, inherited.pairs);

  const total = leftScan.files.size + rightScan.files.size;
  let done = 0;
  const onHashed = (current: string): void => {
    done += 1;
    hooks.onProgress?.({ phase: "hash", done, total, current });
  };

  const leftHashed = await hashSide(
    request.leftRoot,
    leftScan.files,
    cacheFromIndex(loaded.data, "left"),
    request.ignoreCache,
    onHashed,
  );
  const rightHashed = await hashSide(
    request.rightRoot,
    rightScan.files,
    cacheFromIndex(loaded.data, "right"),
    request.ignoreCache,
    onHashed,
  );

  hooks.onProgress?.({ phase: "pair", done: 0, total: 1, current: "" });
  const pairing = pairFiles(leftHashed.entries, rightHashed.entries, indexPairs);

  const ignoredByPath = new Map<RelPath, IgnoredFile>();
  for (const item of [
    ...leftScan.ignored,
    ...rightScan.ignored,
    ...leftHashed.failed,
    ...rightHashed.failed,
  ]) {
    if (!ignoredByPath.has(item.path)) ignoredByPath.set(item.path, item);
  }

  const plan = planSync({
    pairs: pairing.pairs,
    left: leftHashed.entries,
    right: rightHashed.entries,
    leftOnly: pairing.leftOnly,
    rightOnly: pairing.rightOnly,
    ignored: [...ignoredByPath.values()],
    direction: request.direction,
    align: request.align,
  });

  hooks.onProgress?.({ phase: "index", done: 0, total: 1, current: "" });
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
    actions: plan.actions,
    stats: plan.stats,
    warnings: [...loaded.warnings, ...inherited.warnings],
  };
}
