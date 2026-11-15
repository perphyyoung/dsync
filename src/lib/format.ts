export function formatSize(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
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
