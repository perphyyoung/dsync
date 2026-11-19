import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MAX_DIR_PAIRS, RECENT_PAIR_LIMIT, pairKey, type DirPairEntry } from "./dir-pairs";
import type { FilterPrefs } from "./types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dir_pairs (
  pair_key   TEXT PRIMARY KEY,
  left       TEXT NOT NULL,
  right      TEXT NOT NULL,
  used_at    TEXT,
  filters    TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

const SELECT_COLUMNS = "SELECT left, right, used_at, filters FROM dir_pairs";
const ORDER_BY = " ORDER BY (used_at IS NULL), used_at DESC";

interface Row {
  left: string;
  right: string;
  used_at: string | null;
  filters: string | null;
}

function isFilterPrefs(value: unknown): value is FilterPrefs {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["sizeEnabled"] === "boolean" &&
    typeof item["sizeMin"] === "number" &&
    typeof item["sizeMax"] === "number" &&
    typeof item["sizeMinUnit"] === "string" &&
    typeof item["sizeMaxUnit"] === "string" &&
    typeof item["maxDepth"] === "number" &&
    typeof item["includeInput"] === "string" &&
    typeof item["excludeInput"] === "string" &&
    typeof item["includeKeywordInput"] === "string" &&
    typeof item["excludeKeywordInput"] === "string" &&
    (item["timeMode"] === "none" ||
      item["timeMode"] === "recent" ||
      item["timeMode"] === "custom") &&
    typeof item["dateFrom"] === "string" &&
    typeof item["dateTo"] === "string" &&
    typeof item["recentDays"] === "number" &&
    typeof item["skipHidden"] === "boolean"
  );
}

/** filters 是 JSON 列：损坏时当没有存档，不阻断启动 */
function parseFilters(raw: string | null): FilterPrefs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isFilterPrefs(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toEntry(row: Row): DirPairEntry {
  return {
    left: row.left,
    right: row.right,
    usedAt: row.used_at,
    filters: parseFilters(row.filters),
  };
}

export interface MainStore {
  list(): DirPairEntry[];
  recent(limit?: number): DirPairEntry[];
  search(keyword: string): DirPairEntry[];
  /** 保存条件，不动 usedAt */
  save(left: string, right: string, filters: FilterPrefs): DirPairEntry[];
  /** 扫描成功：更新 usedAt，保留已有条件 */
  touch(left: string, right: string): DirPairEntry[];
  /** 旧 recent-pairs.json 的一次性导入 */
  importLegacy(list: { left: string; right: string; savedAt: string }[]): void;
  /** 删除一个目录对的存档 */
  remove(left: string, right: string): void;
  /** 应用级设置：键值对，缺失表示用默认值 */
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
  close(): void;
}

/** 应用级主库 dsync-main.db：目录对档案 + 应用设置，容量 100 组 */
export function openMainDb(filePath: string): MainStore {
  if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec("PRAGMA journal_mode = DELETE");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(SCHEMA);

  /** 保留 recent 排序下的前 100 组 */
  const trim = (): void => {
    db.exec(
      `DELETE FROM dir_pairs WHERE pair_key NOT IN (
        SELECT pair_key FROM dir_pairs ORDER BY (used_at IS NULL), used_at DESC LIMIT ${MAX_DIR_PAIRS}
      )`,
    );
  };

  /* null 参数经 COALESCE 回退到原值：save 不动 used_at，touch 不动 filters */
  /* left/right 不更新：保留首次写入的显示顺序，左右互换仍命中同一组 */
  const upsert = db.prepare(`
    INSERT INTO dir_pairs (pair_key, left, right, used_at, filters, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(pair_key) DO UPDATE SET
      used_at = COALESCE(excluded.used_at, dir_pairs.used_at),
      filters = COALESCE(excluded.filters, dir_pairs.filters),
      updated_at = excluded.updated_at
  `);

  const listAll = (): DirPairEntry[] =>
    (db.prepare(`${SELECT_COLUMNS}${ORDER_BY}`).all() as unknown as Row[]).map(toEntry);

  function save(left: string, right: string, filters: FilterPrefs): DirPairEntry[] {
    const now = new Date().toISOString();
    upsert.run(pairKey(left, right), left, right, null, JSON.stringify(filters), now);
    trim();
    return listAll();
  }

  function touch(left: string, right: string): DirPairEntry[] {
    const now = new Date().toISOString();
    upsert.run(pairKey(left, right), left, right, now, null, now);
    trim();
    return listAll();
  }

  function recent(limit = RECENT_PAIR_LIMIT): DirPairEntry[] {
    const rows = db
      .prepare(`${SELECT_COLUMNS} WHERE used_at IS NOT NULL ORDER BY used_at DESC LIMIT ?`)
      .all(limit) as unknown as Row[];
    return rows.map(toEntry);
  }

  function search(keyword: string): DirPairEntry[] {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return recent();
    const escaped = kw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const rows = db
      .prepare(`${SELECT_COLUMNS} WHERE pair_key LIKE ? ESCAPE '\\'${ORDER_BY} LIMIT ?`)
      .all(`%${escaped}%`, MAX_DIR_PAIRS) as unknown as Row[];
    return rows.map(toEntry);
  }

  function importLegacy(list: { left: string; right: string; savedAt: string }[]): void {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO dir_pairs (pair_key, left, right, used_at, filters, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    );
    for (const item of list) {
      insert.run(pairKey(item.left, item.right), item.left, item.right, item.savedAt, item.savedAt);
    }
    trim();
  }

  function remove(left: string, right: string): void {
    db.prepare("DELETE FROM dir_pairs WHERE pair_key = ?").run(pairKey(left, right));
  }

  function getSetting(key: string): string | null {
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  function setSetting(key: string, value: string): void {
    db.prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }

  function deleteSetting(key: string): void {
    db.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  }

  return {
    list: listAll,
    recent,
    search,
    save,
    touch,
    importLegacy,
    remove,
    getSetting,
    setSetting,
    deleteSetting,
    close: () => db.close(),
  };
}
