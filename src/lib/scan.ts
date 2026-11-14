import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { extMatch } from "./exts";
import { relativePosix } from "./path-guard";
import type { FileStat, FilterOptions, RelPath } from "./types";

export { normalizeExts, parseExtInput } from "./exts";

export const DSYNC_DIR = ".dsync";
export const TMP_SUFFIX = ".dsynctmp";

const ALWAYS_IGNORED = new Set([DSYNC_DIR, ".DS_Store", "Thumbs.db"]);

export type IgnoreReason = "internal" | "size" | "ext" | "symlink" | "special" | "unreadable";

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

function filterReason(name: string, size: number, options: FilterOptions): IgnoreReason | null {
  if (ALWAYS_IGNORED.has(name) || name.toLowerCase().endsWith(TMP_SUFFIX)) return "internal";
  if (size < options.minSize) return "size";
  if (options.includeExts.length > 0 && !extMatch(name, options.includeExts)) return "ext";
  if (extMatch(name, options.excludeExts)) return "ext";
  return null;
}

export async function scanDirectory(root: string, options: FilterOptions): Promise<ScanOutcome> {
  const files = new Map<RelPath, FileStat>();
  const ignored: IgnoredFile[] = [];
  const nestedIndexDirs: RelPath[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
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
        await walk(full);
        continue;
      }
      if (!entry.isFile()) {
        ignored.push({ path: rel, reason: "special", size: 0 });
        continue;
      }

      const info = await stat(full);
      const reason = filterReason(entry.name, info.size, options);
      if (reason) {
        ignored.push({ path: rel, reason, size: info.size });
        continue;
      }
      // mtimeMs 带亚毫秒小数，序列化后会与恢复值对不上，统一取整到毫秒
      files.set(rel, { path: rel, size: info.size, mtimeMs: Math.floor(info.mtimeMs) });
    }
  }

  await walk(root);
  return { files, ignored, nestedIndexDirs };
}
