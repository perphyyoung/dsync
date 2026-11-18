import { describe, expect, it } from "vitest";
import { ExecutionCancelledError, ExecutionController } from "./execute-controller";

describe("执行控制器", () => {
  it("未暂停时直接通过", async () => {
    const controller = new ExecutionController();
    await expect(controller.waitIfPaused()).resolves.toBeUndefined();
  });

  it("暂停后等待，继续后放行", async () => {
    const controller = new ExecutionController();
    controller.pause();
    let resumed = false;
    const waiting = controller.waitIfPaused().then(() => {
      resumed = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resumed).toBe(false);

    controller.resume();
    await waiting;
    expect(resumed).toBe(true);
  });

  it("取消后立即抛错，暂停中的等待也会被唤醒", async () => {
    const controller = new ExecutionController();
    controller.pause();
    const waiting = controller.waitIfPaused();
    const assertion = expect(waiting).rejects.toBeInstanceOf(ExecutionCancelledError);
    controller.cancel();
    await assertion;
    expect(() => controller.throwIfCancelled()).toThrow(ExecutionCancelledError);
  });

  it("取消后再次暂停也直接抛错", async () => {
    const controller = new ExecutionController();
    controller.cancel();
    await expect(controller.waitIfPaused()).rejects.toBeInstanceOf(ExecutionCancelledError);
  });
});
