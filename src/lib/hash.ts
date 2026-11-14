import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const READ_CHUNK = 1 << 20;
/** 同时打开的文件句柄上限 */
export const HASH_CONCURRENCY = 8;

export function hashText(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export async function hashFile(fullPath: string): Promise<string> {
  const digest = createHash("sha256");
  const stream = createReadStream(fullPath, { highWaterMark: READ_CHUNK });
  for await (const chunk of stream) {
    digest.update(chunk as Buffer);
  }
  return digest.digest("hex");
}

/** 固定宽度的并发执行，避免一次性打开过多句柄 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  results.length = items.length;
  let cursor = 0;
  const width = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: width }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
