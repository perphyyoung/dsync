import { stat } from "node:fs/promises";
import { hashFile } from "./hash";
import { loadIndexPair, writeIndex } from "./index-file";
import { resolveInsideRoot } from "./path-guard";
import type { HashCache, PairRecord, RehashRequest, RehashResult } from "./types";

async function cacheOf(fullPath: string, hash: string): Promise<HashCache> {
  const info = await stat(fullPath);
  return { hash, size: info.size, mtimeMs: Math.floor(info.mtimeMs) };
}

/**
 * 忽略缓存重算一对文件的哈希，并把结果写回索引缓存。
 * 只刷新 cache，不动 base —— 重算解决的是「判定依据可不可信」，不替用户裁决。
 */
export async function rehashPair(request: RehashRequest): Promise<RehashResult> {
  const leftFull = request.left ? resolveInsideRoot(request.leftRoot, request.left) : null;
  const rightFull = request.right ? resolveInsideRoot(request.rightRoot, request.right) : null;

  const [leftHash, rightHash] = await Promise.all([
    leftFull ? hashFile(leftFull) : Promise.resolve(null),
    rightFull ? hashFile(rightFull) : Promise.resolve(null),
  ]);

  const loaded = await loadIndexPair(request.leftRoot, request.rightRoot);
  const pairs: PairRecord[] = [];
  let changed = false;

  for (const pair of loaded.data.pairs) {
    if (pair.left !== request.left || pair.right !== request.right) {
      pairs.push(pair);
      continue;
    }
    changed = true;
    pairs.push({
      ...pair,
      leftCache: leftFull && leftHash ? await cacheOf(leftFull, leftHash) : pair.leftCache,
      rightCache: rightFull && rightHash ? await cacheOf(rightFull, rightHash) : pair.rightCache,
    });
  }

  if (changed) {
    const next = { ...loaded.data, updatedAt: new Date().toISOString(), pairs };
    await Promise.all([writeIndex(request.leftRoot, next), writeIndex(request.rightRoot, next)]);
  }

  return { leftHash, rightHash };
}
