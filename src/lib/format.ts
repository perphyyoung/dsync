import type { SyncAction } from "./types";

function pad(part: number): string {
  return String(part).padStart(2, "0");
}

export function formatSize(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 执行用时：不足 1 分钟保留 1 位小数，之后按分钟取整 */
export function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} 秒`;
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${minutes} 分` : `${minutes} 分 ${rest} 秒`;
}

/** 修改日期只显示到天，本地时区 YYYY-MM-DD */
export function formatDate(date: number | null): string {
  if (date === null) return "";
  const value = new Date(date);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * 剩余时间按量级取整，避免秒级跳动。
 * 不封顶：分钟之后进小时，小时级取整到 5 分钟。
 * 样本不足时返回 null，由调用方决定是否隐藏这一行。
 */
export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (seconds <= 0) return null;
  if (seconds < 10) return `剩余约 ${Math.max(1, Math.round(seconds))} 秒`;
  if (seconds < 60) return `剩余约 ${Math.round(seconds / 5) * 5} 秒`;

  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `剩余约 ${totalMinutes} 分钟`;

  const roundedMinutes = Math.round(seconds / 300) * 5;
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (minutes === 0) return `剩余约 ${hours} 小时`;
  return `剩余约 ${hours} 小时 ${minutes} 分钟`;
}

export interface EtaHint {
  text: string;
  level: "tip" | "strong";
}

/** 5 分钟起给缩小范围的建议，1 小时起明确建议取消后分批 */
const HINT_MIN_SECONDS = 300;
const HINT_STRONG_SECONDS = 3600;

export function etaHint(seconds: number | null | undefined): EtaHint | null {
  if (seconds === null || seconds === undefined) return null;
  if (seconds >= HINT_STRONG_SECONDS) {
    return { text: "预计超过 1 小时，建议先取消，缩小目录范围后分批同步", level: "strong" };
  }
  if (seconds >= HINT_MIN_SECONDS) {
    return { text: "耗时较长，可用过滤条件缩小范围，或随时暂停", level: "tip" };
  }
  return null;
}

/** 把一条动作写成可读的一行，用于确认框逐条列出 */
export function describeAction(action: SyncAction): string {
  if (action.kind === "copy") {
    const from = action.fromPath ?? "";
    /* 同路径复制只写一次文件名；结构对齐后目标路径不同时才显示 from → to */
    return from && from !== action.toPath
      ? `复制 ${from} → ${action.toPath}`
      : `复制 ${action.toPath}`;
  }
  if (action.kind === "move") return `改名 ${action.fromPath ?? ""} → ${action.toPath}`;
  return `软删除 ${action.toPath}`;
}
