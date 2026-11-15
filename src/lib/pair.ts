import type { FileEntry, HashCache, PairRecord, RelPath } from "./types";

export interface PairingResult {
  pairs: PairRecord[];
  leftOnly: RelPath[];
  rightOnly: RelPath[];
}

function cacheOf(entry: FileEntry): HashCache {
  return { hash: entry.hash, size: entry.size, mtimeMs: entry.mtimeMs };
}

function groupByHash(files: Map<RelPath, FileEntry>): Map<string, RelPath[]> {
  const groups = new Map<string, RelPath[]>();
  for (const [path, entry] of files) {
    const list = groups.get(entry.hash);
    if (list) list.push(path);
    else groups.set(entry.hash, [path]);
  }
  return groups;
}

/**
 * 只按内容哈希配对：两侧同哈希且各只有一个时成立。
 * 哈希不同就是不同文件，不做任何猜测；单侧重复哈希无法判断谁对应谁，一律不配。
 */
export function pairFiles(
  left: Map<RelPath, FileEntry>,
  right: Map<RelPath, FileEntry>,
): PairingResult {
  const usedLeft = new Set<RelPath>();
  const usedRight = new Set<RelPath>();
  const pairs: PairRecord[] = [];

  const leftByHash = groupByHash(left);
  const rightByHash = groupByHash(right);

  for (const [hash, leftPaths] of leftByHash) {
    const rightPaths = rightByHash.get(hash);
    if (!rightPaths || leftPaths.length !== 1 || rightPaths.length !== 1) continue;
    const leftPath = leftPaths[0];
    const rightPath = rightPaths[0];
    const leftEntry = left.get(leftPath);
    const rightEntry = right.get(rightPath);
    if (!leftEntry || !rightEntry) continue;

    usedLeft.add(leftPath);
    usedRight.add(rightPath);
    pairs.push({
      left: leftPath,
      right: rightPath,
      base: hash,
      leftCache: cacheOf(leftEntry),
      rightCache: cacheOf(rightEntry),
      pairedBy: "hash",
      syncedAt: null,
    });
  }

  const sortedPairs = pairs.toSorted((a, b) => a.left.localeCompare(b.left));
  const leftOnly = [...left.keys()].filter((path) => !usedLeft.has(path)).toSorted();
  const rightOnly = [...right.keys()].filter((path) => !usedRight.has(path)).toSorted();
  return { pairs: sortedPairs, leftOnly, rightOnly };
}
