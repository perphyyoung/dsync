import type { DiffRow, ScanResult } from "./types";

const MIRROR_STATUS: Partial<Record<DiffRow["status"], DiffRow["status"]>> = {
  "left-only": "right-only",
  "right-only": "left-only",
};

/**
 * 左右目录互换后，把扫描结果镜像到新方向，无需重新扫描。
 * 行序与行号不变，路径 / 大小 / 日期 / 哈希与单侧状态左右对调，统计同步对调。
 */
export function mirrorScanResult(result: ScanResult): ScanResult {
  return {
    rows: result.rows.map((row) => ({
      ...row,
      left: row.right,
      right: row.left,
      leftSize: row.rightSize,
      rightSize: row.leftSize,
      leftDate: row.rightDate,
      rightDate: row.leftDate,
      leftHash: row.rightHash,
      rightHash: row.leftHash,
      status: MIRROR_STATUS[row.status] ?? row.status,
    })),
    stats: {
      ...result.stats,
      leftOnly: result.stats.rightOnly,
      rightOnly: result.stats.leftOnly,
      duplicateLeft: result.stats.duplicateRight,
      duplicateRight: result.stats.duplicateLeft,
    },
    warnings: result.warnings,
    ...(result.diskKinds
      ? { diskKinds: { left: result.diskKinds.right, right: result.diskKinds.left } }
      : {}),
  };
}
