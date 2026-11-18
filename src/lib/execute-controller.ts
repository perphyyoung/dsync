export class ExecutionCancelledError extends Error {
  constructor() {
    super("执行已取消");
    this.name = "ExecutionCancelledError";
  }
}

/**
 * 执行任务控制器：暂停在动作/分块边界等待，取消立即生效。
 * 暂停时保留文件句柄与偏移，继续后从断点续写。
 */
export class ExecutionController {
  paused = false;
  cancelled = false;
  /** 复制限速（字节/秒），0 表示不限 */
  rateLimitBytesPerSec = 0;

  private waiters: (() => void)[] = [];

  setRateLimit(bytesPerSec: number): void {
    this.rateLimitBytesPerSec = Math.max(0, Math.round(bytesPerSec));
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  cancel(): void {
    this.cancelled = true;
    this.paused = false;
    this.resume();
  }

  async waitIfPaused(): Promise<void> {
    this.throwIfCancelled();
    if (!this.paused) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.throwIfCancelled();
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new ExecutionCancelledError();
  }
}
