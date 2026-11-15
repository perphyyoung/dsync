import { mkdir, rename, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveInsideRoot } from "./path-guard";
import { DSYNC_DIR } from "./scan";
import type { DeletedRecord, RelPath, Side } from "./types";

const DELETED_DIR = "deleted";

export function deletedDir(root: string): string {
  return join(root, DSYNC_DIR, DELETED_DIR);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS deleted (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  path       TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  blob       TEXT NOT NULL,
  size       INTEGER NOT NULL DEFAULT 0
);
`;

async function openDb(root: string): Promise<DatabaseSync> {
  await mkdir(join(root, DSYNC_DIR), { recursive: true });
  const db = new DatabaseSync(join(root, DSYNC_DIR, "dsync.db"));
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec(SCHEMA);
  return db;
}

interface DeletedRow {
  id: number;
  path: string;
  deleted_at: string;
  blob: string;
  size: number;
}

/**
 * 软删除：把文件移进 `<root>/.dsync/deleted/`，并记下原路径。
 * dsync 不真正删除任何文件，彻底删除由用户在文件管理器完成。
 */
export async function softDelete(root: string, relPath: RelPath): Promise<void> {
  const full = resolveInsideRoot(root, relPath);
  const info = await stat(full);
  const db = await openDb(root);
  let id = 0;
  try {
    const inserted = db
      .prepare("INSERT INTO deleted (path, deleted_at, blob, size) VALUES (?, ?, '', ?)")
      .run(relPath, new Date().toISOString(), info.size);
    id = Number(inserted.lastInsertRowid);

    const blob = `${id}-${basename(relPath)}`;
    await mkdir(deletedDir(root), { recursive: true });
    await rename(full, join(deletedDir(root), blob));
    db.prepare("UPDATE deleted SET blob = ? WHERE id = ?").run(blob, id);
  } catch (error) {
    db.prepare("DELETE FROM deleted WHERE id = ?").run(id);
    throw error;
  } finally {
    db.close();
  }
}

/** 列出某一侧回收站里的条目，按删除时间倒序 */
export async function listDeleted(root: string, side: Side): Promise<DeletedRecord[]> {
  const db = await openDb(root);
  try {
    const rows = db
      .prepare("SELECT id, path, deleted_at, blob, size FROM deleted ORDER BY deleted_at DESC")
      .all() as unknown as DeletedRow[];
    return rows.map((row) => ({
      id: row.id,
      side,
      path: row.path,
      deletedAt: row.deleted_at,
      size: row.size,
      blob: row.blob,
    }));
  } finally {
    db.close();
  }
}

/** 还原到原路径；目标已存在时不覆盖 */
export async function restoreDeleted(root: string, id: number): Promise<RelPath> {
  const db = await openDb(root);
  try {
    const row = db.prepare("SELECT path, blob FROM deleted WHERE id = ?").get(id) as unknown as
      | { path: string; blob: string }
      | undefined;
    if (!row) throw new Error("回收站记录不存在");

    const target = resolveInsideRoot(root, row.path);
    try {
      await stat(target);
      throw new Error(`原位置已有文件：${row.path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    await mkdir(dirname(target), { recursive: true });
    await rename(join(deletedDir(root), row.blob), target);
    db.prepare("DELETE FROM deleted WHERE id = ?").run(id);
    return row.path;
  } finally {
    db.close();
  }
}
