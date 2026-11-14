import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { normalizeRoot, pathKey, resolveInsideRoot, toPosix } from "./path-guard";
import { DSYNC_DIR } from "./scan";
import type { HashCache, IndexData, PairRecord, PairedBy, RelPath, Side } from "./types";

const MAGIC = "DSYNCIDX";
const MAGIC_BYTES = Buffer.from(MAGIC, "ascii");
const HEADER_SIZE = 16;
const DIGEST_SIZE = 32;
export const INDEX_FORMAT_VERSION = 1;
export const INDEX_SCHEMA_VERSION = 1;
export const INDEX_FILE_NAME = "index";

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

/** 容器布局：8 字节魔数 + 4 版本 + 4 长度 + JSON 体 + 32 字节 SHA-256 */
export function encodeIndex(data: IndexData): Buffer {
  const body = Buffer.from(JSON.stringify(data), "utf8");
  const header = Buffer.alloc(HEADER_SIZE);
  MAGIC_BYTES.copy(header, 0);
  header.writeUInt32LE(INDEX_FORMAT_VERSION, 8);
  header.writeUInt32LE(body.length, 12);
  const digest = createHash("sha256").update(header).update(body).digest();
  return Buffer.concat([header, body, digest]);
}

export type DecodeResult =
  | { ok: true; data: IndexData; verified: boolean }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const PAIRED_BY = new Set<string>(["index", "path", "name", "hash", "manual", "inherited"]);

function validateCache(value: unknown): HashCache | null {
  if (!isRecord(value)) return null;
  const { hash, size, mtimeMs } = value;
  if (typeof hash !== "string" || typeof size !== "number" || typeof mtimeMs !== "number") {
    return null;
  }
  return { hash, size, mtimeMs };
}

function validateIndex(value: unknown): IndexData | null {
  if (!isRecord(value)) return null;
  const { version, updatedAt, roots, pairs } = value;
  if (typeof version !== "number" || typeof updatedAt !== "string") return null;
  if (!isRecord(roots)) return null;
  if (typeof roots["left"] !== "string" || typeof roots["right"] !== "string") return null;
  if (!Array.isArray(pairs)) return null;

  const validPairs: PairRecord[] = [];
  for (const item of pairs) {
    if (!isRecord(item)) continue;
    const left = item["left"];
    const right = item["right"];
    if (typeof left !== "string" || typeof right !== "string") continue;
    const pairedBy = item["pairedBy"];
    validPairs.push({
      left,
      right,
      base: typeof item["base"] === "string" ? item["base"] : null,
      leftCache: validateCache(item["leftCache"]),
      rightCache: validateCache(item["rightCache"]),
      pairedBy:
        typeof pairedBy === "string" && PAIRED_BY.has(pairedBy) ? (pairedBy as PairedBy) : "index",
      syncedAt: typeof item["syncedAt"] === "string" ? item["syncedAt"] : null,
    });
  }

  return {
    version,
    updatedAt,
    roots: { left: roots["left"], right: roots["right"] },
    pairs: validPairs,
  };
}

export function decodeIndex(buffer: Buffer): DecodeResult {
  if (buffer.length < HEADER_SIZE + DIGEST_SIZE) {
    return { ok: false, error: "索引文件长度不足" };
  }
  if (buffer.subarray(0, MAGIC_BYTES.length).toString("ascii") !== MAGIC) {
    return { ok: false, error: "索引魔数不匹配" };
  }
  const formatVersion = buffer.readUInt32LE(8);
  if (formatVersion !== INDEX_FORMAT_VERSION) {
    return { ok: false, error: `索引容器版本不支持：${formatVersion}` };
  }
  const bodyLength = buffer.readUInt32LE(12);
  if (HEADER_SIZE + bodyLength + DIGEST_SIZE !== buffer.length) {
    return { ok: false, error: "索引长度字段与实际文件不符" };
  }

  const header = buffer.subarray(0, HEADER_SIZE);
  const body = buffer.subarray(HEADER_SIZE, HEADER_SIZE + bodyLength);
  const expected = createHash("sha256").update(header).update(body).digest();
  const actual = buffer.subarray(HEADER_SIZE + bodyLength);
  const verified = expected.equals(actual);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch (error) {
    return { ok: false, error: `索引内容无法解析：${(error as Error).message}` };
  }
  const data = validateIndex(parsed);
  if (!data) return { ok: false, error: "索引结构不合法" };
  return { ok: true, data, verified };
}

export interface ReadIndexOutcome {
  data: IndexData | null;
  warnings: string[];
}

export async function readIndex(root: string): Promise<ReadIndexOutcome> {
  let buffer: Buffer;
  try {
    buffer = await readFile(indexFilePath(root));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { data: null, warnings: [] };
    return { data: null, warnings: [`读取索引失败：${(error as Error).message}`] };
  }

  const result = decodeIndex(buffer);
  if (!result.ok) return { data: null, warnings: [`索引损坏：${result.error}`] };
  if (!result.verified) {
    return { data: result.data, warnings: ["索引校验值不符，已按当前内容接受"] };
  }
  return { data: result.data, warnings: [] };
}

export async function writeIndex(root: string, data: IndexData): Promise<void> {
  const file = indexFilePath(root);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.dsynctmp`;
  await writeFile(tmp, encodeIndex(data));
  await rename(tmp, file);
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

  const chosen = candidates[0];
  const aligned = alignRoots(chosen, leftRoot, rightRoot);
  if (!aligned) {
    warnings.push("索引记录的目录与当前选择不一致，已按空索引处理");
    return { data: emptyIndex(leftRoot, rightRoot), warnings };
  }
  return { data: aligned, warnings };
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

/** 读取子孙目录里的 .dsync/index，重定基后并入当前索引 */
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
