import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { ScanCancelledError, type ScanController } from "./controller";
import { extMatch } from "./exts";
import { relativePosix } from "./path-guard";
import type { FileStat, FilterOptions, RelPath } from "./types";

export { normalizeExts, parseExtInput } from "./exts";

export const DSYNC_DIR = ".dsync";
export const TMP_SUFFIX = ".dsynctmp";

const ALWAYS_IGNORED = new Set([DSYNC_DIR, ".DS_Store", "Thumbs.db"]);

export type IgnoreReason =
  | "internal"
  | "name"
  | "size"
  | "time"
  | "ext"
  | "symlink"
  | "special"
  | "unreadable";

export interface IgnoredFile {
  path: RelPath;
  reason: IgnoreReason;
  size: number;
}

export interface ScanOutcome {
  files: Map<RelPath, FileStat>;
  ignored: IgnoredFile[];
  /** 子孙目录里的 .dsync 相对路径，供索引继承使用 */
  nestedIndexDirs: RelPath[];
}

function filterReason(
  name: string,
  size: number,
  mtimeMs: number,
  options: FilterOptions,
): IgnoreReason | null {
  if (ALWAYS_IGNORED.has(name) || name.toLowerCase().endsWith(TMP_SUFFIX)) return "internal";
  if (nameExcluded(name, options.excludeNames)) return "name";
  if (size < options.minSize) return "size";
  if (options.maxSize > 0 && size > options.maxSize) return "size";
  if (options.modifiedAfter > 0 && mtimeMs < options.modifiedAfter) return "time";
  if (options.modifiedBefore > 0 && mtimeMs > options.modifiedBefore) return "time";
  if (options.includeExts.length > 0 && !extMatch(name, options.includeExts)) return "ext";
  if (extMatch(name, options.excludeExts)) return "ext";
  return null;
}

/** 目录层级：文件层级 = 目录深度 + 1；超过上限的目录整棵跳过（不计入 ignored） */
function tooDeep(depth: number, maxDepth: number): boolean {
  return maxDepth > 0 && depth + 1 >= maxDepth;
}

/** 路径关键词：相对路径包含任一关键词即跳过，限制扫描范围（不计入 ignored） */
function pathExcluded(rel: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = rel.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

/** 文件名关键词：文件名（含扩展名）包含任一关键词即跳过，只作用于文件 */
function nameExcluded(name: string, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const lower = name.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

/** 每个条目都检查一次中断，让扫描阶段也能暂停与取消 */
async function gate(controller?: ScanController): Promise<void> {
  if (!controller) return;
  if (controller.cancelled) throw new ScanCancelledError();
  await controller.waitIfPaused();
  if (controller.cancelled) throw new ScanCancelledError();
}

/**
 * 第一遍：只递归列目录数文件，不读元信息。
 * 作用是给第二遍提供分母，让扫描阶段也能给出真实百分比。
 */
export async function countFiles(
  root: string,
  options: FilterOptions,
  onDiscover?: (found: number) => void,
  controller?: ScanController,
): Promise<number> {
  let count = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      await gate(controller);
      if (entry.isSymbolicLink()) continue;
      const rel = relativePosix(root, join(dir, entry.name));
      if (entry.isDirectory()) {
        if (entry.name === DSYNC_DIR) continue;
        if (options.skipHidden && entry.name.startsWith(".")) continue;
        if (pathExcluded(rel, options.excludePaths)) continue;
        if (tooDeep(depth, options.maxDepth)) continue;
        await walk(join(dir, entry.name), depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (options.skipHidden && entry.name.startsWith(".")) continue;
      if (pathExcluded(rel, options.excludePaths)) continue;
      if (nameExcluded(entry.name, options.excludeNames)) continue;
      count += 1;
      onDiscover?.(count);
    }
  }

  await walk(root, 0);
  return count;
}

/** 第二遍：逐个读取元信息并套用过滤规则 */
export async function collectFiles(
  root: string,
  options: FilterOptions,
  onFile?: () => void,
  controller?: ScanController,
): Promise<ScanOutcome> {
  const files = new Map<RelPath, FileStat>();
  const ignored: IgnoredFile[] = [];
  const nestedIndexDirs: RelPath[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      await gate(controller);
      const full = join(dir, entry.name);
      const rel = relativePosix(root, full);

      if (entry.isSymbolicLink()) {
        ignored.push({ path: rel, reason: "symlink", size: 0 });
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === DSYNC_DIR) {
          // 记录索引所在目录（.dsync 的父目录），而不是 .dsync 自身
          if (rel !== DSYNC_DIR) {
            const slash = rel.lastIndexOf("/");
            const parent = slash >= 0 ? rel.slice(0, slash) : "";
            if (parent) nestedIndexDirs.push(parent);
          }
          continue;
        }
        if (options.skipHidden && entry.name.startsWith(".")) continue;
        if (pathExcluded(rel, options.excludePaths)) continue;
        if (tooDeep(depth, options.maxDepth)) continue;
        await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        ignored.push({ path: rel, reason: "special", size: 0 });
        continue;
      }
      if (options.skipHidden && entry.name.startsWith(".")) continue;
      if (pathExcluded(rel, options.excludePaths)) continue;

      onFile?.();

      let info;
      try {
        info = await stat(full);
      } catch {
        ignored.push({ path: rel, reason: "unreadable", size: 0 });
        continue;
      }

      const reason = filterReason(entry.name, info.size, info.mtimeMs, options);
      if (reason) {
        ignored.push({ path: rel, reason, size: info.size });
        continue;
      }
      // mtimeMs 带亚毫秒小数，序列化后会与恢复值对不上，统一取整到毫秒
      files.set(rel, { path: rel, size: info.size, mtimeMs: Math.floor(info.mtimeMs) });
    }
  }

  await walk(root, 0);
  return { files, ignored, nestedIndexDirs };
}
