import { formatEta } from "./format";
import type { ScanProgress } from "./types";

export type ScanStatus = "running" | "paused" | "cancelled";

/**
 * 进度页状态行：运行中始终有一行，ETA 归零或进入收尾阶段也不消失。
 * 暂停 / 取消由标题表达，不再占用这一行。
 */
export function scanStatusText(progress: ScanProgress | null, status: ScanStatus): string | null {
  if (status !== "running" || !progress) return null;

  switch (progress.phase) {
    case "scan":
      return "正在扫描目录…";
    case "hash": {
      if (progress.total <= 0 || progress.done >= progress.total) return "即将完成";
      const eta = progress.etaSeconds ?? null;
      if (eta !== null && eta <= 0) return "即将完成";
      return formatEta(eta) ?? "正在计算哈希…";
    }
    case "pair":
      return "正在配对…";
    case "index":
      return "正在写入索引…";
  }
}
