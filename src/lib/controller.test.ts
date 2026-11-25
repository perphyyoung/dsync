import { describe, expect, it } from "vitest";
import { RateTracker, ScanCancelledError, ScanController } from "./controller";

describe("ScanController", () => {
  it("暂停会中止当前 signal，恢复后换新 signal", () => {
    const controller = new ScanController();
    const first = controller.signal;

    controller.pause();
    expect(first.aborted).toBe(true);
    expect(controller.paused).toBe(true);

    controller.resume();
    expect(controller.paused).toBe(false);
    expect(controller.resumeCount).toBe(1);
    expect(controller.signal).not.toBe(first);
    expect(controller.signal.aborted).toBe(false);
  });

  it("暂停时 waitIfPaused 挂起，恢复后继续", async () => {
    const controller = new ScanController();
    controller.pause();

    let resumed = false;
    const waiting = controller.waitIfPaused().then(() => {
      resumed = true;
    });

    await Promise.resolve();
    expect(resumed).toBe(false);

    controller.resume();
    await waiting;
    expect(resumed).toBe(true);
  });

  it("取消会唤醒挂起并标记 cancelled", async () => {
    const controller = new ScanController();
    controller.pause();

    const waiting = controller.waitIfPaused();
    controller.cancel();
    await waiting;

    expect(controller.cancelled).toBe(true);
    expect(controller.paused).toBe(false);
  });

  it("已取消时 waitIfPaused 立即返回", async () => {
    const controller = new ScanController();
    controller.cancel();
    await expect(controller.waitIfPaused()).resolves.toBeUndefined();
  });

  it("取消错误有独立名字，便于区分中断原因", () => {
    expect(new ScanCancelledError().name).toBe("ScanCancelledError");
  });
});

describe("RateTracker", () => {
  it("样本跨度不足 1 秒时不估算", () => {
    const tracker = new RateTracker();
    tracker.record(0, 1000);
    tracker.record(500, 1400);
    expect(tracker.rate(1400)).toBeNull();
    expect(tracker.eta(1000, 1400)).toBeNull();
  });

  it("按窗口内速率估算剩余秒数", () => {
    const tracker = new RateTracker();
    tracker.record(0, 0);
    tracker.record(1000, 1000);
    expect(tracker.rate(1000)).toBe(1000);
    expect(tracker.eta(3000, 1000)).toBe(2);
  });

  it("已完成时剩余为 0", () => {
    const tracker = new RateTracker();
    tracker.record(0, 0);
    tracker.record(500, 1000);
    expect(tracker.eta(500, 1000)).toBe(0);
  });

  it("reset 后不再给出估算", () => {
    const tracker = new RateTracker();
    tracker.record(0, 0);
    tracker.record(500, 1000);
    tracker.reset();
    expect(tracker.rate(1000)).toBeNull();
  });

  it("ETA 涨慢跌快，抑制颤振", () => {
    const tracker = new RateTracker();
    tracker.record(0, 0);
    tracker.record(1000, 1000); // 1000/s，剩余 9000 → 9s
    expect(tracker.eta(10000, 1000)).toBe(9);

    tracker.record(1100, 2000); // 跌到 550/s，原始 ETA 16.2，只报到 10
    expect(tracker.eta(10000, 2000)).toBe(10);

    tracker.record(5000, 2500); // 升到 2000/s，原始 ETA 2.5，一次降到 6
    expect(tracker.eta(10000, 2500)).toBe(6);
  });
});
