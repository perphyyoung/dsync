import type { MismatchEntry, RefreshedRow, SyncAction } from "./types";

/**
 * 执行后对账：拿实际结果与动作预期对比。
 * 只报告不符，不改状态；状态更新由调用方按 refresh 结果完成。
 */
export function verifyOutcome(actions: SyncAction[], refreshed: RefreshedRow[]): MismatchEntry[] {
  const lastByRow = new Map<number, SyncAction>();
  for (const action of actions) lastByRow.set(action.rowIndex, action);

  const mismatched: MismatchEntry[] = [];
  for (const row of refreshed) {
    const action = lastByRow.get(row.rowIndex);
    if (!action) continue;

    if (action.kind === "delete") {
      const gone = action.side === "left" ? !row.left : !row.right;
      if (!gone) {
        mismatched.push({ path: action.toPath, expected: "该侧已删除", actual: "文件仍在" });
      }
      continue;
    }

    if (!row.left || !row.right) {
      mismatched.push({ path: action.toPath, expected: "两侧都有文件", actual: "一侧缺失" });
      continue;
    }
    if (row.left.hash !== row.right.hash) {
      mismatched.push({ path: action.toPath, expected: "两侧内容一致", actual: "内容不同" });
    }
  }

  return mismatched;
}
