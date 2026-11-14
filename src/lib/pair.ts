import type { FileEntry, HashCache, PairRecord, PairedBy, RelPath } from "./types";

export interface PairingResult {
  pairs: PairRecord[];
  leftOnly: RelPath[];
  rightOnly: RelPath[];
}

function cacheOf(entry: FileEntry): HashCache {
  return { hash: entry.hash, size: entry.size, mtimeMs: entry.mtimeMs };
}

function baseName(path: RelPath): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function groupBy(
  files: Map<RelPath, FileEntry>,
  used: Set<RelPath>,
  keyOf: (path: RelPath) => string,
): Map<string, RelPath[]> {
  const groups = new Map<string, RelPath[]>();
  for (const path of files.keys()) {
    if (used.has(path)) continue;
    const key = keyOf(path);
    const list = groups.get(key);
    if (list) list.push(path);
    else groups.set(key, [path]);
  }
  return groups;
}

/**
 * 四级配对：索引记忆 → 相对路径 → 文件名唯一 → 内容哈希唯一。
 * 后两级只在 1 对 1 时成立，避免重复内容张冠李戴。
 */
export function pairFiles(
  left: Map<RelPath, FileEntry>,
  right: Map<RelPath, FileEntry>,
  indexPairs: PairRecord[],
): PairingResult {
  const usedLeft = new Set<RelPath>();
  const usedRight = new Set<RelPath>();
  const pairs: PairRecord[] = [];

  const claim = (
    leftPath: RelPath,
    rightPath: RelPath,
    pairedBy: PairedBy,
    base: string | null,
  ): void => {
    if (usedLeft.has(leftPath) || usedRight.has(rightPath)) return;
    const leftEntry = left.get(leftPath);
    const rightEntry = right.get(rightPath);
    if (!leftEntry || !rightEntry) return;
    usedLeft.add(leftPath);
    usedRight.add(rightPath);
    pairs.push({
      left: leftPath,
      right: rightPath,
      base,
      leftCache: cacheOf(leftEntry),
      rightCache: cacheOf(rightEntry),
      pairedBy,
      syncedAt: null,
    });
  };

  for (const pair of indexPairs) {
    claim(pair.left, pair.right, pair.pairedBy === "inherited" ? "inherited" : "index", pair.base);
  }

  for (const [path, entry] of left) {
    const peer = right.get(path);
    if (!peer) continue;
    claim(path, path, "path", entry.hash === peer.hash ? entry.hash : null);
  }

  const leftByName = groupBy(left, usedLeft, (path) => baseName(path).toLowerCase());
  const rightByName = groupBy(right, usedRight, (path) => baseName(path).toLowerCase());
  for (const [name, leftPaths] of leftByName) {
    const rightPaths = rightByName.get(name);
    if (!rightPaths || leftPaths.length !== 1 || rightPaths.length !== 1) continue;
    const leftPath = leftPaths[0];
    const rightPath = rightPaths[0];
    const leftHash = left.get(leftPath)?.hash;
    const rightHash = right.get(rightPath)?.hash;
    claim(leftPath, rightPath, "name", leftHash === rightHash ? (leftHash ?? null) : null);
  }

  const leftByHash = groupBy(left, usedLeft, (path) => left.get(path)?.hash ?? "");
  const rightByHash = groupBy(right, usedRight, (path) => right.get(path)?.hash ?? "");
  for (const [hash, leftPaths] of leftByHash) {
    if (!hash) continue;
    const rightPaths = rightByHash.get(hash);
    if (!rightPaths || leftPaths.length !== 1 || rightPaths.length !== 1) continue;
    claim(leftPaths[0], rightPaths[0], "hash", hash);
  }

  const sortedPairs = pairs.toSorted((a, b) => a.left.localeCompare(b.left));
  const leftOnly = [...left.keys()].filter((path) => !usedLeft.has(path)).toSorted();
  const rightOnly = [...right.keys()].filter((path) => !usedRight.has(path)).toSorted();
  return { pairs: sortedPairs, leftOnly, rightOnly };
}
