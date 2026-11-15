import { copyFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveInsideRoot } from "./path-guard";
import { TMP_SUFFIX } from "./scan";
import type { ExecuteRequest, ExecuteResult, Side } from "./types";

export interface ExecuteDeps {
  /** 删除实现，桌面端注入回收站，测试注入 rm */
  trash: (fullPath: string) => Promise<void>;
}

async function copyAtomic(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}${TMP_SUFFIX}`;
  await copyFile(source, tmp);
  await rename(tmp, target);
}

export async function executeActions(
  request: ExecuteRequest,
  deps: ExecuteDeps,
  onProgress?: (done: number, total: number) => void,
): Promise<ExecuteResult> {
  const rootOf = (side: Side): string => (side === "left" ? request.leftRoot : request.rightRoot);
  const result: ExecuteResult = {
    copied: 0,
    moved: 0,
    deleted: 0,
    failed: [],
    moves: [],
    stale: [],
  };
  const total = request.actions.length;

  for (const [index, action] of request.actions.entries()) {
    try {
      const targetRoot = rootOf(action.side);
      const targetFull = resolveInsideRoot(targetRoot, action.toPath);

      if (action.kind === "copy") {
        const sourceRoot = rootOf(action.side === "left" ? "right" : "left");
        const sourceFull = resolveInsideRoot(sourceRoot, action.fromPath ?? action.toPath);
        await copyAtomic(sourceFull, targetFull);
        result.copied += 1;
      } else if (action.kind === "move") {
        const from = action.fromPath ?? action.toPath;
        const sourceFull = resolveInsideRoot(targetRoot, from);
        await mkdir(dirname(targetFull), { recursive: true });
        await rename(sourceFull, targetFull);
        result.moved += 1;
        result.moves.push({ side: action.side, from, to: action.toPath });
      } else if (action.kind === "soft-delete") {
        // ponytail: 暂时仍进系统回收站，内置回收站（.dsync/deleted）在第二批替换
        await deps.trash(targetFull);
        result.deleted += 1;
      }
    } catch (error) {
      result.failed.push({ path: action.toPath, message: (error as Error).message });
    }
    onProgress?.(index + 1, total);
  }

  return result;
}
