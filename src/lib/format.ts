export function formatSize(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 剩余时间按量级取整，避免秒级跳动；
 * 样本不足时返回 null，由调用方决定是否隐藏这一行。
 */
export function formatEta(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (seconds <= 0) return null;
  if (seconds < 10) return `剩余约 ${Math.max(1, Math.round(seconds))} 秒`;
  if (seconds < 60) return `剩余约 ${Math.round(seconds / 5) * 5} 秒`;
  if (seconds < 600) return `剩余约 ${Math.round(seconds / 60)} 分钟`;
  return "剩余超过 10 分钟";
}
