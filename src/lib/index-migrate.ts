import { loadIndexPair, patchIndex, type PairKey } from "./index-file";
import type { MoveRecord, PairRecord, RelPath } from "./types";

/**
 * rename 不改变内容、大小与 mtime，旧路径的哈希缓存对新路径依然有效。
 * 这里只把索引里的路径换掉，缓存跟着 pair 一起迁移，
 * 避免移动后重扫时把文件内容重新读一遍。
 */
export async function migrateMoveCaches(
  leftRoot: string,
  rightRoot: string,
  moves: MoveRecord[],
): Promise<void> {
  if (moves.length === 0) return;

  const leftMap = new Map<RelPath, RelPath>();
  const rightMap = new Map<RelPath, RelPath>();
  for (const move of moves) {
    if (move.side === "left") leftMap.set(move.from, move.to);
    else rightMap.set(move.from, move.to);
  }

  const loaded = await loadIndexPair(leftRoot, rightRoot);
  const upserts: PairRecord[] = [];
  const deletes: PairKey[] = [];

  for (const pair of loaded.data.pairs) {
    const left = leftMap.get(pair.left) ?? pair.left;
    const right = rightMap.get(pair.right) ?? pair.right;
    if (left === pair.left && right === pair.right) continue;
    deletes.push({ left: pair.left, right: pair.right });
    upserts.push({ ...pair, left, right });
  }

  if (upserts.length === 0) return;

  await Promise.all([
    patchIndex(leftRoot, { upserts, deletes }),
    patchIndex(rightRoot, { upserts, deletes }),
  ]);
}
