import { describe, expect, it } from "vitest";
import { scanStatusText } from "./scan-status";
import type { ScanProgress } from "./types";

const base: ScanProgress = { phase: "hash", done: 0, total: 100, current: "" };

describe("扫描进度状态行", () => {
  it("非运行态不显示", () => {
    expect(scanStatusText(null, "running")).toBeNull();
    expect(scanStatusText({ ...base, etaSeconds: 5 }, "paused")).toBeNull();
    expect(scanStatusText({ ...base, etaSeconds: 5 }, "cancelled")).toBeNull();
  });

  it("扫描、配对、写索引阶段有明确文案", () => {
    expect(scanStatusText({ ...base, phase: "scan" }, "running")).toBe("正在扫描目录…");
    expect(scanStatusText({ ...base, phase: "pair", done: 0, total: 1 }, "running")).toBe(
      "正在配对…",
    );
    expect(scanStatusText({ ...base, phase: "index", done: 0, total: 1 }, "running")).toBe(
      "正在写入索引…",
    );
  });

  it("哈希阶段优先显示 ETA", () => {
    expect(scanStatusText({ ...base, done: 20, etaSeconds: 5 }, "running")).toBe("剩余约 5 秒");
  });

  it("ETA 归零、字节已满或全部命中缓存时显示即将完成", () => {
    expect(scanStatusText({ ...base, done: 20, etaSeconds: 0 }, "running")).toBe("即将完成");
    expect(scanStatusText({ ...base, done: 100, etaSeconds: null }, "running")).toBe("即将完成");
    expect(scanStatusText({ ...base, total: 0, etaSeconds: null }, "running")).toBe("即将完成");
  });

  it("ETA 样本不足时仍保留状态行", () => {
    expect(scanStatusText({ ...base, done: 20, etaSeconds: null }, "running")).toBe(
      "正在计算哈希…",
    );
  });
});
