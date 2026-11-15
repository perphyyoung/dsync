import { stat } from "node:fs/promises";
import { hashFile } from "./hash";
import { loadIndexPair, writeIndex } from "./index-file";
import { resolveInsideRoot } from "./path-guard";
import type {
  ExecuteRequest,
  HashCache,
  PairRecord,
  RefreshTarget,
  RefreshedFile,
  RefreshedRow,
  RelPath,
  Side,
  StaleEntry,
} from "./types";

function cacheMap(pairs: PairRecord[], side: Side): Map<RelPath, HashCache> {
  const map = new Map<RelPath, HashCache>();
  for (const pair of pairs) {
    const cache = side === "left" ? pair.leftCache : pair.rightCache;
    if (cache) map.set(side === "left" ? pair.left : pair.right, cache);
  }
  return map;
}

interface FileState {
  exists: boolean;
  size: number;
  mtimeMs: number;
}

async function stateOf(root: string, path: RelPath): Promise<FileState> {
  try {
    const info = await stat(resolveInsideRoot(root, path));
    return { exists: true, size: info.size, mtimeMs: Math.floor(info.mtimeMs) };
  } catch {
    return { exists: false, size: 0, mtimeMs: 0 };
  }
}

function changed(cache: HashCache, state: { size: number; mtimeMs: number }): boolean {
  return cache.size !== state.size || cache.mtimeMs !== state.mtimeMs;
}

async function inspect(
  root: string,
  path: RelPath | null,
  cache: HashCache | undefined,
): Promise<RefreshedFile | null> {
  if (!path) return null;
  const full = resolveInsideRoot(root, path);
  let info;
  try {
    info = await stat(full);
  } catch {
    return null;
  }
  const mtimeMs = Math.floor(info.mtimeMs);
  if (cache && cache.size === info.size && cache.mtimeMs === mtimeMs) {
    return { path, hash: cache.hash, size: info.size, mtimeMs };
  }
  const hash = await hashFile(full);
  return { path, hash, size: info.size, mtimeMs };
}

/**
 * 局部刷新：只 stat 受影响的文件，缓存命中就不读内容。
 * 结果回写索引 cache，让下次全量扫描继续命中。
 */
export async function refreshPaths(
  leftRoot: string,
  rightRoot: string,
  targets: RefreshTarget[],
): Promise<RefreshedRow[]> {
  const loaded = await loadIndexPair(leftRoot, rightRoot);
  const leftCaches = cacheMap(loaded.data.pairs, "left");
  const rightCaches = cacheMap(loaded.data.pairs, "right");

  const results: RefreshedRow[] = [];
  for (const target of targets) {
    results.push({
      rowIndex: target.rowIndex,
      left: await inspect(
        leftRoot,
        target.left,
        target.left ? leftCaches.get(target.left) : undefined,
      ),
      right: await inspect(
        rightRoot,
        target.right,
        target.right ? rightCaches.get(target.right) : undefined,
      ),
    });
  }

  const leftFiles = new Map<RelPath, RefreshedFile>();
  const rightFiles = new Map<RelPath, RefreshedFile>();
  for (const row of results) {
    if (row.left) leftFiles.set(row.left.path, row.left);
    if (row.right) rightFiles.set(row.right.path, row.right);
  }

  let changedAny = false;
  const pairs = loaded.data.pairs.map((pair) => {
    const left = leftFiles.get(pair.left);
    const right = rightFiles.get(pair.right);
    if (!left && !right) return pair;
    changedAny = true;
    return {
      ...pair,
      leftCache: left
        ? { hash: left.hash, size: left.size, mtimeMs: left.mtimeMs }
        : pair.leftCache,
      rightCache: right
        ? { hash: right.hash, size: right.size, mtimeMs: right.mtimeMs }
        : pair.rightCache,
    };
  });

  if (changedAny) {
    const next = { ...loaded.data, updatedAt: new Date().toISOString(), pairs };
    await Promise.all([writeIndex(leftRoot, next), writeIndex(rightRoot, next)]);
  }

  return results;
}

/**
 * 执行前校验：动作碰到的文件是否在扫描后被外部改过。
 * 命中的动作不执行，避免覆盖用户刚改的内容。
 */
export async function detectStale(
  request: ExecuteRequest,
  pairs: PairRecord[],
): Promise<StaleEntry[]> {
  const leftCaches = cacheMap(pairs, "left");
  const rightCaches = cacheMap(pairs, "right");
  const stale: StaleEntry[] = [];

  const rootOf = (side: Side): string => (side === "left" ? request.leftRoot : request.rightRoot);
  const cacheOf = (side: Side, path: RelPath): HashCache | undefined =>
    (side === "left" ? leftCaches : rightCaches).get(path);

  for (const action of request.actions) {
    if (action.kind === "copy") {
      const sourcePath = action.fromPath ?? action.toPath;
      const sourceSide: Side = action.side === "left" ? "right" : "left";
      const sourceState = await stateOf(rootOf(sourceSide), sourcePath);
      const sourceCache = cacheOf(sourceSide, sourcePath);
      if (!sourceState.exists || (sourceCache && changed(sourceCache, sourceState))) {
        stale.push({ path: action.toPath, reason: "source-changed" });
        continue;
      }

      const targetState = await stateOf(rootOf(action.side), action.toPath);
      const targetCache = cacheOf(action.side, action.toPath);
      if (!targetCache && targetState.exists) {
        stale.push({ path: action.toPath, reason: "target-created" });
        continue;
      }
      if (targetCache && (!targetState.exists || changed(targetCache, targetState))) {
        stale.push({ path: action.toPath, reason: "target-changed" });
      }
      continue;
    }

    if (action.kind === "move") {
      const sourcePath = action.fromPath ?? action.toPath;
      const sourceState = await stateOf(rootOf(action.side), sourcePath);
      const sourceCache = cacheOf(action.side, sourcePath);
      if (!sourceState.exists || (sourceCache && changed(sourceCache, sourceState))) {
        stale.push({ path: action.toPath, reason: "source-changed" });
        continue;
      }

      const targetState = await stateOf(rootOf(action.side), action.toPath);
      if (targetState.exists) {
        stale.push({ path: action.toPath, reason: "target-created" });
      }
      continue;
    }

    const state = await stateOf(rootOf(action.side), action.toPath);
    const cache = cacheOf(action.side, action.toPath);
    if (cache && (!state.exists || changed(cache, state))) {
      stale.push({ path: action.toPath, reason: "target-changed" });
    }
  }

  return stale;
}
