/** 用户取消扫描 */
export class ScanCancelledError extends Error {
  constructor() {
    super("扫描已取消");
    this.name = "ScanCancelledError";
  }
}

/** 一次扫描的中断控制：暂停会中止当前文件读取，恢复后该文件从头重读 */
export class ScanController {
  private abortController = new AbortController();
  private resumeResolver: (() => void) | null = null;

  paused = false;
  cancelled = false;
  /** 恢复次数；进度层用它判断是否需要清空速度窗口 */
  resumeCount = 0;

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  pause(): void {
    if (this.paused || this.cancelled) return;
    this.paused = true;
    this.abortController.abort();
  }

  resume(): void {
    if (!this.paused || this.cancelled) return;
    this.paused = false;
    this.resumeCount += 1;
    this.abortController = new AbortController();
    const resolve = this.resumeResolver;
    this.resumeResolver = null;
    resolve?.();
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.paused = false;
    this.abortController.abort();
    const resolve = this.resumeResolver;
    this.resumeResolver = null;
    resolve?.();
  }

  /** 暂停时挂起；恢复或取消后返回。worker 在取下一个任务前调用 */
  async waitIfPaused(): Promise<void> {
    if (!this.paused || this.cancelled) return;
    await new Promise<void>((resolve) => {
      this.resumeResolver = resolve;
    });
  }
}

/** 最近窗口内的完成速率，用于估算剩余时间 */
export class RateTracker {
  private samples: { time: number; done: number }[] = [];
  private readonly windowMs: number;

  constructor(windowMs = 3000) {
    this.windowMs = windowMs;
  }

  record(done: number, now = Date.now()): void {
    this.samples.push({ time: now, done });
    this.prune(now);
  }

  /** 恢复后清空，避免把暂停时长算进速度 */
  reset(): void {
    this.samples = [];
  }

  /** 每秒完成量；跨度不足 1 秒时返回 null */
  rate(now = Date.now()): number | null {
    this.prune(now);
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last) return null;
    const span = last.time - first.time;
    if (span < 1000) return null;
    const delta = last.done - first.done;
    if (delta <= 0) return null;
    return (delta / span) * 1000;
  }

  /** 剩余秒数；样本不足返回 null，已完成返回 0 */
  eta(total: number, now = Date.now()): number | null {
    const last = this.samples[this.samples.length - 1];
    if (!last) return null;
    const remaining = total - last.done;
    if (remaining <= 0) return 0;
    const speed = this.rate(now);
    if (speed === null) return null;
    return Math.round(remaining / speed);
  }

  private prune(now: number): void {
    while (this.samples.length > 2 && now - this.samples[0].time > this.windowMs) {
      this.samples.shift();
    }
  }
}
