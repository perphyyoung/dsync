import { readFile } from "node:fs/promises";
import type { RecentPair } from "./types";

function isRecentPair(value: unknown): value is RecentPair {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item["left"] === "string" &&
    typeof item["right"] === "string" &&
    typeof item["savedAt"] === "string"
  );
}

/** 旧 recent-pairs.json 的数组结构；现仅用于迁移到 dir-pairs.json */
export function parseRecentPairs(raw: string): RecentPair[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecentPair);
}

/** 最近目录对是应用级配置，读失败一律当空列表，不阻断启动 */
export async function readRecentPairs(filePath: string): Promise<RecentPair[]> {
  try {
    return parseRecentPairs(await readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}
