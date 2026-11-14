import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RecentPair } from "./types";

export const MAX_RECENT_PAIRS = 10;

function pairKey(left: string, right: string): string {
  return `${left.toLowerCase()}\u0000${right.toLowerCase()}`;
}

/** 新加入的排最前，同组去重，最多保留 MAX_RECENT_PAIRS 组 */
export function mergeRecentPair(
  list: RecentPair[],
  pair: { left: string; right: string },
  now = new Date().toISOString(),
): RecentPair[] {
  if (!pair.left || !pair.right) return list;
  const key = pairKey(pair.left, pair.right);
  const rest = list.filter((item) => pairKey(item.left, item.right) !== key);
  return [{ left: pair.left, right: pair.right, savedAt: now }, ...rest].slice(0, MAX_RECENT_PAIRS);
}

function isRecentPair(value: unknown): value is RecentPair {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["left"] === "string" &&
    typeof item["right"] === "string" &&
    typeof item["savedAt"] === "string"
  );
}

export function parseRecentPairs(raw: string): RecentPair[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecentPair).slice(0, MAX_RECENT_PAIRS);
}

/** 最近目录对是应用级配置，读失败一律当空列表，不阻断启动 */
export async function readRecentPairs(filePath: string): Promise<RecentPair[]> {
  try {
    return parseRecentPairs(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

export async function writeRecentPairs(filePath: string, list: RecentPair[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(list, null, 2), "utf8");
}
