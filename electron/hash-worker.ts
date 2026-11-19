/* eslint-disable unicorn/require-post-message-target-origin -- Node worker_threads 的 postMessage 没有 targetOrigin 参数 */
import { parentPort } from "node:worker_threads";
import { hashFile } from "../src/lib/hash";

interface HashMessage {
  type: "hash";
  id: number;
  path: string;
}

interface CancelMessage {
  type: "cancel";
  id: number;
}

type Message = HashMessage | CancelMessage;

/** worker 每 100ms 批量上报一次，避免按块产生大量消息 */
const PROGRESS_INTERVAL_MS = 100;

let current: { id: number; controller: AbortController } | null = null;

function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (item["type"] === "cancel") return typeof item["id"] === "number";
  return (
    item["type"] === "hash" && typeof item["id"] === "number" && typeof item["path"] === "string"
  );
}

async function run(message: HashMessage): Promise<void> {
  const controller = new AbortController();
  current = { id: message.id, controller };
  let pendingBytes = 0;

  const flush = (): void => {
    if (pendingBytes === 0) return;
    parentPort?.postMessage({ type: "progress", id: message.id, bytes: pendingBytes });
    pendingBytes = 0;
  };
  const timer = setInterval(flush, PROGRESS_INTERVAL_MS);

  try {
    const hash = await hashFile(message.path, {
      signal: controller.signal,
      onChunk: (bytes) => {
        pendingBytes += bytes;
      },
    });
    flush();
    parentPort?.postMessage({ type: "done", id: message.id, hash });
  } catch (error) {
    flush();
    const failure = error as Error;
    parentPort?.postMessage({
      type: "error",
      id: message.id,
      name: failure.name,
      message: failure.message,
    });
  } finally {
    clearInterval(timer);
    if (current?.id === message.id) current = null;
  }
}

parentPort?.on("message", (raw: unknown) => {
  if (!isMessage(raw)) return;
  if (raw.type === "cancel") {
    if (current?.id === raw.id) current.controller.abort();
    return;
  }
  if (current) return;
  void run(raw);
});
