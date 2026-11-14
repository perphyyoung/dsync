import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FileEntry } from "./types";

export async function makeBase(prefix = "dsync-test-"): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function writeRel(root: string, rel: string, content: string): Promise<void> {
  const full = join(root, ...rel.split("/"));
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, "utf8");
}

export function entry(path: string, hash: string, size = 1): FileEntry {
  return { path, size, mtimeMs: 1, hash };
}

export function collection(...items: FileEntry[]): Map<string, FileEntry> {
  return new Map(items.map((item) => [item.path, item]));
}
