import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeRoot, pathKey, resolveInsideRoot, toPosix } from "./path-guard";
import { DSYNC_DIR } from "./scan";
import type { HashCache, IndexData, PairRecord, PairedBy, RelPath, Side } from "./types";

export const INDEX_SCHEMA_VERSION = 1;
export const INDEX_FILE_NAME = "dsync.db";

export function indexFilePath(root: string): string {
  return join(root, DSYNC_DIR, INDEX_FILE_NAME);
}

export function emptyIndex(leftRoot: string, rightRoot: string): IndexData {
  return {
    version: INDEX_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    roots: { left: normalizeRoot(leftRoot), right: normalizeRoot(rightRoot) },
    pairs: [],
  };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pairs (
  left_path  TEXT NOT NULL,
  right_path TEXT NOT NULL,
  paired_by  TEXT NOT NULL,
  base       TEXT,
  left_hash  TEXT, left_size INTEGER, left_mtime INTEGER,
  right_hash TEXT, right_size INTEGER, right_mtime INTEGER,
  synced_at  TEXT,
  PRIMARY KEY (left_path, right_path)
);
CREATE INDEX IF NOT EXISTS idx_pairs_left  ON pairs(left_path);
CREATE INDEX IF NOT EXISTS idx_pairs_right ON pairs(right_path);
`;

interface PairRow {
  left_path: string;
  right_path: string;
  paired_by: string;
  base: string | null;
  left_hash: string | null;
  left_size: number | null;
  left_mtime: number | null;
  right_hash: string | null;
  right_size: number | null;
  right_mtime: number | null;
  synced_at: string | null;
}

const PAIRED_BY = new Set<string>(["index", "path", "name", "hash", "manual", "inherited"]);

function toPair(row: PairRow): PairRecord {
  return {
    left: row.left_path,
    right: row.right_path,
    pairedBy: PAIRED_BY.has(row.paired_by) ? (row.paired_by as PairedBy) : "index",
    base: row.base,
    syncedAt: row.synced_at,
    leftCache:
      row.left_hash !== null && row.left_size !== null && row.left_mtime !== null
        ? { hash: row.left_hash, size: row.left_size, mtimeMs: row.left_mtime }
        : null,
    rightCache:
      row.right_hash !== null && row.right_size !== null && row.right_mtime !== null
        ? { hash: row.right_hash, size: row.right_size, mtimeMs: row.right_mtime }
        : null,
  };
}

function pairParams(pair: PairRecord): (string | number | null)[] {
  return [
    pair.left,
    pair.right,
    pair.pairedBy,
    pair.base ?? null,
    pair.leftCache?.hash ?? null,
    pair.leftCache?.size ?? null,
    pair.leftCache?.mtimeMs ?? null,
    pair.rightCache?.hash ?? null,
    pair.rightCache?.size ?? null,
    pair.rightCache?.mtimeMs ?? null,
    pair.syncedAt ?? null,
  ];
}

const UPSERT_SQL = `INSERT OR REPLACE INTO pairs
  (left_path, right_path, paired_by, base,
   left_hash, left_size, left_mtime, right_hash, right_size, right_mtime, synced_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function openForWrite(root: string): Promise<DatabaseSync> {
  await mkdir(join(root, DSYNC_DIR), { recursive: true });
  const db = new DatabaseSync(indexFilePath(root));
  // 网盘同步场景不要 WAL：多出的 -wal/-shm 文件更容易被同步成不一致状态
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(SCHEMA);
  return db;
}

export interface ReadIndexOutcome {
  data: IndexData | null;
  warnings: string[];
}

export async function readIndex(root: string): Promise<ReadIndexOutcome> {
  const file = indexFilePath(root);
  if (!existsSync(file)) return { data: null, warnings: [] };

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file);
    const metaRows = db.prepare("SELECT key, value FROM meta").all() as unknown as {
      key: string;
      value: string;
    }[];
    const meta = new Map(metaRows.map((row) => [row.key, row.value]));
    const rows = db.prepare("SELECT * FROM pairs").all() as unknown as PairRow[];
    return {
      data: {
        version: Number(meta.get("version") ?? INDEX_SCHEMA_VERSION),
        roots: { left: meta.get("left") ?? "", right: meta.get("right") ?? "" },
        updatedAt: meta.get("updatedAt") ?? "",
        pairs: rows.map(toPair),
      },
      warnings: [],
    };
  } catch (error) {
    return { data: null, warnings: [`索引不可用：${(error as Error).message}`] };
  } finally {
    db?.close();
  }
}

/** 全量替换：扫描结束后写一次 */
export async function writeIndex(root: string, data: IndexData): Promise<void> {
  const db = await openForWrite(root);
  try {
    db.exec("BEGIN");
    db.exec("DELETE FROM pairs");
    const upsert = db.prepare(UPSERT_SQL);
    for (const pair of data.pairs) upsert.run(...pairParams(pair));

    const setMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
    setMeta.run("version", String(data.version));
    setMeta.run("left", data.roots.left);
    setMeta.run("right", data.roots.right);
    setMeta.run("updatedAt", data.updatedAt);
    db.exec("COMMIT");
  } finally {
    // 未提交的事务在 close 时自动回滚
    db.close();
  }
}

export interface PairKey {
  left: RelPath;
  right: RelPath;
}

export interface IndexPatch {
  upserts?: PairRecord[];
  deletes?: PairKey[];
}

/** 局部写入：只动给定的配对，供刷新、迁移、单行重算使用 */
export async function patchIndex(root: string, patch: IndexPatch): Promise<void> {
  const upserts = patch.upserts ?? [];
  const deletes = patch.deletes ?? [];
  if (upserts.length === 0 && deletes.length === 0) return;

  const db = await openForWrite(root);
  try {
    db.exec("BEGIN");
    if (deletes.length > 0) {
      const remove = db.prepare("DELETE FROM pairs WHERE left_path = ? AND right_path = ?");
      for (const key of deletes) remove.run(key.left, key.right);
    }
    if (upserts.length > 0) {
      const upsert = db.prepare(UPSERT_SQL);
      for (const pair of upserts) upsert.run(...pairParams(pair));
    }
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      "updatedAt",
      new Date().toISOString(),
    );
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}

export interface LoadIndexOutcome {
  data: IndexData;
  warnings: string[];
}

/** 左右内嵌路径与当前选择不一致时，先把索引整体换到当前视角 */
function alignRoots(index: IndexData, leftRoot: string, rightRoot: string): IndexData | null {
  const indexLeft = pathKey(normalizeRoot(index.roots.left));
  const indexRight = pathKey(normalizeRoot(index.roots.right));
  const targetLeft = pathKey(normalizeRoot(leftRoot));
  const targetRight = pathKey(normalizeRoot(rightRoot));

  if (indexLeft === targetLeft && indexRight === targetRight) {
    return { ...index, roots: { left: leftRoot, right: rightRoot } };
  }
  if (indexLeft === targetRight && indexRight === targetLeft) {
    return {
      ...index,
      roots: { left: leftRoot, right: rightRoot },
      pairs: index.pairs.map((pair) => ({
        ...pair,
        left: pair.right,
        right: pair.left,
        leftCache: pair.rightCache,
        rightCache: pair.leftCache,
      })),
    };
  }
  return null;
}

/** 把索引里的某一侧哈希缓存按根目录收集出来 */
function sideCaches(index: IndexData, root: string): Map<RelPath, HashCache> {
  const target = pathKey(normalizeRoot(root));
  const leftMatch = pathKey(normalizeRoot(index.roots.left)) === target;
  const rightMatch = pathKey(normalizeRoot(index.roots.right)) === target;
  const caches = new Map<RelPath, HashCache>();
  if (!leftMatch && !rightMatch) return caches;

  for (const pair of index.pairs) {
    if (leftMatch && pair.leftCache) caches.set(pair.left, pair.leftCache);
    if (rightMatch && pair.rightCache) caches.set(pair.right, pair.rightCache);
  }
  return caches;
}

/** 根目录不匹配时不再丢弃全部缓存：按侧分别捞，配对新对时仍能复用哈希 */
function salvageSideCaches(
  candidates: IndexData[],
  leftRoot: string,
  rightRoot: string,
): IndexData {
  const left = new Map<RelPath, HashCache>();
  const right = new Map<RelPath, HashCache>();
  for (const index of candidates) {
    for (const [path, cache] of sideCaches(index, leftRoot)) left.set(path, cache);
    for (const [path, cache] of sideCaches(index, rightRoot)) right.set(path, cache);
  }

  const paths = new Set([...left.keys(), ...right.keys()]);
  const pairs: PairRecord[] = [...paths]
    .toSorted((a, b) => a.localeCompare(b))
    .map((path) => ({
      left: path,
      right: path,
      base: null,
      leftCache: left.get(path) ?? null,
      rightCache: right.get(path) ?? null,
      pairedBy: "index" as const,
      syncedAt: null,
    }));

  return {
    version: INDEX_SCHEMA_VERSION,
    updatedAt:
      candidates
        .map((index) => index.updatedAt)
        .toSorted()
        .at(-1) ?? "",
    roots: { left: leftRoot, right: rightRoot },
    pairs,
  };
}

/** 两份索引取 updatedAt 较新者，不做字段级合并 */
export async function loadIndexPair(
  leftRoot: string,
  rightRoot: string,
): Promise<LoadIndexOutcome> {
  const [leftOutcome, rightOutcome] = await Promise.all([
    readIndex(leftRoot),
    readIndex(rightRoot),
  ]);
  const warnings = [
    ...leftOutcome.warnings.map((item) => `左侧：${item}`),
    ...rightOutcome.warnings.map((item) => `右侧：${item}`),
  ];

  const candidates = [leftOutcome.data, rightOutcome.data].filter(
    (item): item is IndexData => item !== null,
  );
  if (candidates.length === 0) {
    return { data: emptyIndex(leftRoot, rightRoot), warnings };
  }
  candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  for (const candidate of candidates) {
    const aligned = alignRoots(candidate, leftRoot, rightRoot);
    if (aligned) return { data: aligned, warnings };
  }
  return { data: salvageSideCaches(candidates, leftRoot, rightRoot), warnings };
}

interface PrefixShift {
  add: string;
  strip: string;
}

/** 把「索引自己的根」映射到「当前根」：要么拼前缀，要么剥前缀 */
function shiftFor(indexRoot: string, currentRoot: string): PrefixShift | null {
  const index = pathKey(normalizeRoot(indexRoot));
  const current = pathKey(normalizeRoot(currentRoot));
  if (index === current) return { add: "", strip: "" };

  // 盘符根（D:\）本身已带分隔符，不能再追加一个
  const indexPrefix = index.endsWith(sep) ? index : `${index}${sep}`;
  const currentPrefix = current.endsWith(sep) ? current : `${current}${sep}`;

  if (index.startsWith(currentPrefix)) {
    return { add: toPosix(index.slice(currentPrefix.length)), strip: "" };
  }
  if (current.startsWith(indexPrefix)) {
    return { add: "", strip: toPosix(current.slice(indexPrefix.length)) };
  }
  return null;
}

function applyShift(path: RelPath, shift: PrefixShift): RelPath | null {
  if (shift.strip) {
    const prefix = shift.strip;
    if (path.length === prefix.length) return null;
    if (!path.toLowerCase().startsWith(`${prefix.toLowerCase()}/`)) return null;
    return path.slice(prefix.length + 1);
  }
  return shift.add ? `${shift.add}/${path}` : path;
}

/** 把索引里的相对路径重定基到当前根；任一侧映射不上就整份放弃 */
export function rebaseIndex(
  index: IndexData,
  leftRoot: string,
  rightRoot: string,
): PairRecord[] | null {
  const leftShift = shiftFor(index.roots.left, leftRoot);
  const rightShift = shiftFor(index.roots.right, rightRoot);
  if (!leftShift || !rightShift) return null;

  const pairs: PairRecord[] = [];
  for (const pair of index.pairs) {
    const left = applyShift(pair.left, leftShift);
    const right = applyShift(pair.right, rightShift);
    if (!left || !right) continue;
    pairs.push({ ...pair, left, right });
  }
  return pairs;
}

function depthOf(rel: RelPath): number {
  return rel.split("/").length;
}

/** 读取子孙目录里的 .dsync/dsync.db，重定基后并入当前索引 */
export async function collectInherited(
  leftRoot: string,
  rightRoot: string,
  nestedDirs: RelPath[],
): Promise<{ pairs: PairRecord[]; warnings: string[] }> {
  const warnings: string[] = [];
  const pairs: PairRecord[] = [];
  const ordered = [...nestedDirs].toSorted((a, b) => depthOf(a) - depthOf(b));

  for (const dir of ordered) {
    const childRoot = resolveInsideRoot(leftRoot, dir);
    const outcome = await readIndex(childRoot);
    if (!outcome.data) {
      if (outcome.warnings.length > 0) {
        warnings.push(`子目录索引 ${dir} 不可用：${outcome.warnings.join("；")}`);
      }
      continue;
    }
    const rebased = rebaseIndex(outcome.data, leftRoot, rightRoot);
    if (!rebased) {
      warnings.push(`子目录索引 ${dir} 的目录记录与当前不匹配，已跳过`);
      continue;
    }
    for (const pair of rebased) {
      pairs.push({ ...pair, pairedBy: "inherited" });
    }
  }
  return { pairs, warnings };
}

/** 当前索引优先；继承来的配对只在两侧路径都未被占用时生效 */
export function mergePairs(current: PairRecord[], inherited: PairRecord[]): PairRecord[] {
  const usedLeft = new Set(current.map((pair) => pathKey(pair.left)));
  const usedRight = new Set(current.map((pair) => pathKey(pair.right)));
  const merged = [...current];

  for (const pair of inherited) {
    const leftKey = pathKey(pair.left);
    const rightKey = pathKey(pair.right);
    if (usedLeft.has(leftKey) || usedRight.has(rightKey)) continue;
    usedLeft.add(leftKey);
    usedRight.add(rightKey);
    merged.push(pair);
  }
  return merged;
}

/** 从索引里提取某一侧的哈希缓存 */
export function cacheFromIndex(index: IndexData, side: Side): Map<RelPath, HashCache> {
  const map = new Map<RelPath, HashCache>();
  for (const pair of index.pairs) {
    const path = side === "left" ? pair.left : pair.right;
    const cache = side === "left" ? pair.leftCache : pair.rightCache;
    if (cache) map.set(path, cache);
  }
  return map;
}
