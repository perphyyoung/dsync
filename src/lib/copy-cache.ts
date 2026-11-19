import type { CopyRecord, HashCache, PairRecord } from "./types";

function cache(hash: string, size: number, mtimeMs: number): HashCache {
  return { hash, size, mtimeMs };
}

/** 把成功复制的已知哈希转成索引配对，供 patchIndex 定点写入 */
export function copyCachePairs(copies: CopyRecord[]): PairRecord[] {
  const syncedAt = new Date().toISOString();
  return copies.map((copy) => {
    const source = cache(copy.hash, copy.size, copy.sourceMtimeMs);
    const target = cache(copy.hash, copy.size, copy.mtimeMs);
    if (copy.side === "left") {
      return {
        left: copy.to,
        right: copy.from,
        base: null,
        leftCache: target,
        rightCache: source,
        pairedBy: "path",
        syncedAt,
      };
    }
    return {
      left: copy.from,
      right: copy.to,
      base: null,
      leftCache: source,
      rightCache: target,
      pairedBy: "path",
      syncedAt,
    };
  });
}
