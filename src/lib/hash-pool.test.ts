import { describe, expect, it } from "vitest";
import { HashWorkerPool, type HashWorker } from "./hash-pool";

class FakeWorker implements HashWorker {
  messages: Record<string, unknown>[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((payload: unknown) => void)[]>();

  postMessage(message: unknown): void {
    this.messages.push(message as Record<string, unknown>);
  }

  on(event: string, listener: (payload: never) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as (payload: unknown) => void);
    this.listeners.set(event, list);
    return this;
  }

  terminate(): number {
    this.terminated = true;
    return 0;
  }

  emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  get lastHashId(): number {
    const message = [...this.messages].toReversed().find((item) => item["type"] === "hash");
    return Number(message?.["id"] ?? -1);
  }
}

function setup(concurrency = 1): { pool: HashWorkerPool; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const pool = new HashWorkerPool(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  pool.setConcurrency(concurrency);
  return { pool, workers };
}

describe("哈希 worker 池", () => {
  it("按并发数排队，完成后返回哈希", async () => {
    const { pool, workers } = setup(2);
    const first = pool.hashFile("a");
    const second = pool.hashFile("b");
    const third = pool.hashFile("c");

    await Promise.resolve();
    expect(workers).toHaveLength(2);
    expect(workers[0].lastHashId).toBe(1);
    expect(workers[1].lastHashId).toBe(2);
    expect(workers[0].messages.some((item) => item["type"] === "hash")).toBe(true);

    workers[0].emit("message", { type: "done", id: 1, hash: "ha" });
    await expect(first).resolves.toBe("ha");
    await Promise.resolve();
    expect(workers[0].lastHashId).toBe(3);

    workers[1].emit("message", { type: "done", id: 2, hash: "hb" });
    workers[0].emit("message", { type: "done", id: 3, hash: "hc" });
    await expect(second).resolves.toBe("hb");
    await expect(third).resolves.toBe("hc");
    pool.destroy();
  });

  it("进度回调透传 worker 批量字节", async () => {
    const { pool, workers } = setup(1);
    const chunks: number[] = [];
    const task = pool.hashFile("a", { onChunk: (bytes) => chunks.push(bytes) });
    await Promise.resolve();
    workers[0].emit("message", { type: "progress", id: 1, bytes: 1024 });
    workers[0].emit("message", { type: "progress", id: 1, bytes: 2048 });
    workers[0].emit("message", { type: "done", id: 1, hash: "ha" });
    await expect(task).resolves.toBe("ha");
    expect(chunks).toEqual([1024, 2048]);
    pool.destroy();
  });

  it("取消在跑任务时给 worker 发 cancel，AbortError 原样抛出", async () => {
    const { pool, workers } = setup(1);
    const controller = new AbortController();
    const task = pool.hashFile("a", { signal: controller.signal });
    await Promise.resolve();

    controller.abort();
    expect(workers[0].messages.at(-1)).toMatchObject({ type: "cancel", id: 1 });

    const error = new Error("aborted");
    error.name = "AbortError";
    workers[0].emit("message", { type: "error", id: 1, name: error.name, message: error.message });
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    pool.destroy();
  });

  it("取消排队中的任务不占用 worker，后续任务继续", async () => {
    const { pool, workers } = setup(1);
    const first = pool.hashFile("a");
    const controller = new AbortController();
    const second = pool.hashFile("b", { signal: controller.signal });
    const third = pool.hashFile("c");

    controller.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });

    workers[0].emit("message", { type: "done", id: 1, hash: "ha" });
    await expect(first).resolves.toBe("ha");
    await Promise.resolve();
    expect(workers[0].lastHashId).toBe(3);

    workers[0].emit("message", { type: "done", id: 3, hash: "hc" });
    await expect(third).resolves.toBe("hc");
    pool.destroy();
  });

  it("worker 崩溃时当前任务失败并补一个新 worker", async () => {
    const { pool, workers } = setup(1);
    const task = pool.hashFile("a");
    await Promise.resolve();

    workers[0].emit("error", new Error("boom"));
    await expect(task).rejects.toThrow("boom");
    await Promise.resolve();
    expect(workers).toHaveLength(2);
    pool.destroy();
  });
});
