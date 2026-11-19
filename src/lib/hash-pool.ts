/* eslint-disable unicorn/require-post-message-target-origin -- Node worker_threads 的 postMessage 没有 targetOrigin 参数 */
export interface HashWorker {
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  terminate(): Promise<number> | number;
}

export type HashWorkerFactory = () => HashWorker;

export interface HashTaskOptions {
  signal?: AbortSignal;
  /** 每读到一块的字节数；worker 端按 100ms 批量上报 */
  onChunk?: (bytes: number) => void;
}

interface PendingTask {
  id: number;
  path: string;
  resolve: (hash: string) => void;
  reject: (error: Error) => void;
  onChunk?: (bytes: number) => void;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

interface Slot {
  worker: HashWorker;
  task: PendingTask | null;
}

function abortError(): Error {
  const error = new Error("哈希已取消");
  error.name = "AbortError";
  return error;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readMessage(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

/**
 * 哈希 worker 池：主进程只负责排队与汇总，SHA-256 在 worker 里跑。
 * 每个 worker 同时只处理一个文件；worker 崩溃时当前任务失败并自动补一个。
 */
export class HashWorkerPool {
  private readonly slots: Slot[] = [];
  private readonly queue: PendingTask[] = [];
  private concurrency = 1;
  private nextId = 1;
  private destroyed = false;

  constructor(private readonly createWorker: HashWorkerFactory) {}

  setConcurrency(value: number): void {
    const next = Math.max(1, Math.floor(value));
    this.concurrency = next;
    if (this.destroyed) return;
    this.ensureWorkers();
    this.trimIdle();
    this.pump();
  }

  hashFile(fullPath: string, options: HashTaskOptions = {}): Promise<string> {
    if (this.destroyed) return Promise.reject(new Error("哈希线程池已关闭"));
    if (options.signal?.aborted) return Promise.reject(abortError());

    return new Promise<string>((resolve, reject) => {
      const task: PendingTask = {
        id: this.nextId,
        path: fullPath,
        resolve,
        reject,
        onChunk: options.onChunk,
        signal: options.signal,
      };
      this.nextId += 1;

      if (options.signal) {
        task.abortHandler = () => this.abortTask(task);
        options.signal.addEventListener("abort", task.abortHandler, { once: true });
      }

      this.queue.push(task);
      this.pump();
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const task of this.queue.splice(0)) this.rejectTask(task, new Error("哈希线程池已关闭"));
    for (const slot of this.slots.splice(0)) {
      if (slot.task) this.rejectTask(slot.task, new Error("哈希线程池已关闭"));
      void slot.worker.terminate();
    }
  }

  private ensureWorkers(): void {
    while (!this.destroyed && this.slots.length < this.concurrency) {
      if (!this.spawn()) return;
    }
  }

  private spawn(): boolean {
    let worker: HashWorker;
    try {
      worker = this.createWorker();
    } catch {
      return false;
    }
    const slot: Slot = { worker, task: null };
    this.slots.push(slot);
    worker.on("message", (message) => this.onMessage(slot, message));
    worker.on("error", (error) => this.onWorkerFailure(slot, error));
    worker.on("exit", (code) => {
      if (code !== 0) this.onWorkerFailure(slot, new Error(`哈希 worker 退出：${code}`));
    });
    return true;
  }

  private onMessage(slot: Slot, raw: unknown): void {
    const message = readMessage(raw);
    const task = slot.task;
    if (!message || !task) return;
    if (readNumber(message["id"]) !== task.id) return;

    const type = readString(message["type"]);
    if (type === "progress") {
      const bytes = readNumber(message["bytes"]);
      if (bytes !== null && bytes > 0) task.onChunk?.(bytes);
      return;
    }
    if (type === "done") {
      const hash = readString(message["hash"]);
      this.finishTask(slot, task);
      if (hash === null) task.reject(new Error("哈希 worker 返回无效结果"));
      else task.resolve(hash);
      return;
    }
    if (type === "error") {
      const error = new Error(readString(message["message"]) ?? "哈希失败");
      error.name = readString(message["name"]) ?? "Error";
      this.finishTask(slot, task);
      task.reject(error);
    }
  }

  private finishTask(slot: Slot, task: PendingTask): void {
    if (task.abortHandler && task.signal) {
      task.signal.removeEventListener("abort", task.abortHandler);
    }
    slot.task = null;
    this.trimIdle();
    this.pump();
  }

  private rejectTask(task: PendingTask, error: Error): void {
    if (task.abortHandler && task.signal) {
      task.signal.removeEventListener("abort", task.abortHandler);
    }
    task.reject(error);
  }

  private abortTask(task: PendingTask): void {
    const index = this.queue.indexOf(task);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.rejectTask(task, abortError());
      return;
    }
    const slot = this.slots.find((item) => item.task === task);
    if (!slot) return;
    slot.worker.postMessage({ type: "cancel", id: task.id });
  }

  private onWorkerFailure(slot: Slot, error: Error): void {
    const index = this.slots.indexOf(slot);
    if (index < 0) return;
    this.slots.splice(index, 1);
    void slot.worker.terminate();
    if (slot.task) this.rejectTask(slot.task, error);
    if (this.destroyed) return;
    this.ensureWorkers();
    this.pump();
  }

  private trimIdle(): void {
    for (let i = this.slots.length - 1; i >= 0 && this.slots.length > this.concurrency; i -= 1) {
      const slot = this.slots[i];
      if (slot.task) continue;
      this.slots.splice(i, 1);
      void slot.worker.terminate();
    }
  }

  private pump(): void {
    if (this.destroyed) return;
    while (this.queue.length > 0) {
      const slot = this.slots.find((item) => item.task === null);
      if (!slot) return;
      const task = this.queue.shift();
      if (!task) return;
      if (task.signal?.aborted) {
        this.rejectTask(task, abortError());
        continue;
      }
      slot.task = task;
      slot.worker.postMessage({ type: "hash", id: task.id, path: task.path });
    }
  }
}
