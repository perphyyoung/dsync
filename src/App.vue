<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import BatchPage from "./components/BatchPage.vue";
import ConfirmBubble from "./components/ConfirmBubble.vue";
import DirPicker from "./components/DirPicker.vue";
import FileList from "./components/FileList.vue";
import FilterPanel from "./components/FilterPanel.vue";
import ProgressPage from "./components/ProgressPage.vue";
import RecyclePage from "./components/RecyclePage.vue";
import RowActions from "./components/RowActions.vue";
import ToastBubble from "./components/ToastBubble.vue";
import { computeBatchStats, detectTargetConflicts } from "./lib/batch";
import { parseExtInput } from "./lib/exts";
import { baseName } from "./lib/format";
import { actionForRow } from "./lib/plan";
import { rowDirections } from "./lib/row-actions";
import { verifyOutcome } from "./lib/verify";
import type {
  AlignMode,
  BatchStats,
  DeletedRecord,
  DiffRow,
  MismatchEntry,
  RefreshTarget,
  RefreshedFile,
  RefreshedRow,
  ScanProgress,
  ScanResult,
  ScanStats,
  Side,
  StaleEntry,
  SyncAction,
} from "./lib/types";

const leftRoot = ref("");
const rightRoot = ref("");
const minSizeKb = ref(0);
const includeInput = ref("");
const excludeInput = ref("");
const hideSame = ref(true);

const scanning = ref(false);
const executing = ref(false);
const progress = ref<ScanProgress | null>(null);
const forceRehashActive = ref(false);
const progressView = ref<"hidden" | "running" | "paused" | "cancelled">("hidden");
const result = ref<ScanResult | null>(null);
const selected = ref<Set<number>>(new Set());
const toast = ref<string | null>(null);
const alerts = ref<string[]>([]);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const batchOpen = ref(false);
const batchBaseline = ref<Side>("left");
const batchReorder = ref(false);

const recycleOpen = ref(false);
const recycleItems = ref<DeletedRecord[]>([]);
const recycleBusy = ref(false);
const rowMenu = ref<{ rowIndex: number; side: Side; x: number; y: number } | null>(null);
const softDeleteConfirm = ref<{ rowIndex: number; side: Side } | null>(null);

const busy = computed(() => scanning.value || executing.value);

const softDeleteMessage = computed(() => {
  const target = softDeleteConfirm.value;
  if (!target) return "";
  const row = result.value?.rows[target.rowIndex];
  const path = row?.[target.side] ?? "";
  return `${path}\n移入回收站后可以还原；dsync 不会真正删除文件。`;
});

const items = computed(() => {
  const rows = result.value?.rows ?? [];
  return rows
    .map((row, index) => ({ row, index }))
    .filter((item) => !hideSame.value || item.row.status !== "same");
});

const pendingCount = computed(() => {
  const rows = result.value?.rows ?? [];
  return rows.filter((row) => row.status !== "same" && row.status !== "ignored").length;
});

const statsTooltip = computed(() => {
  const stats = result.value?.stats;
  if (!stats) return "";
  return (
    `一致 ${stats.same} · 仅路径 ${stats.moved} · 重复 ${stats.duplicate} · ` +
    `仅左 ${stats.leftOnly} · 仅右 ${stats.rightOnly} · 忽略 ${stats.ignored}`
  );
});

const batchTargetSide = computed<Side>(() => (batchBaseline.value === "left" ? "right" : "left"));

const batchStats = computed<BatchStats>(() => {
  const rows = result.value?.rows ?? [];
  return computeBatchStats(rows, selected.value, batchTargetSide.value, batchReorder.value);
});

const progressStatus = computed<"running" | "paused" | "cancelled">(() =>
  progressView.value === "hidden" ? "running" : progressView.value,
);

let unsubscribeProgress: (() => void) | null = null;
let unsubscribeRecent: (() => void) | null = null;

onMounted(() => {
  unsubscribeProgress = window.api.onProgress((next) => {
    progress.value = next;
  });
  unsubscribeRecent = window.api.onLoadRecent((pair) => {
    leftRoot.value = pair.left;
    rightRoot.value = pair.right;
  });

  void restoreLastPair();
});

/** 启动时只回填上次的目录对，不自动扫描；扫描由用户手动发起 */
async function restoreLastPair(): Promise<void> {
  try {
    const recent = await window.api.listRecent();
    const last = recent[0];
    if (!last) return;
    leftRoot.value = last.left;
    rightRoot.value = last.right;
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

onUnmounted(() => {
  unsubscribeProgress?.();
  unsubscribeRecent?.();
  if (toastTimer) clearTimeout(toastTimer);
});

async function pick(side: "left" | "right"): Promise<void> {
  const picked = await window.api.pickDirectory();
  if (!picked) return;
  if (side === "left") leftRoot.value = picked;
  else rightRoot.value = picked;
}

/** 结果只对应当前目录与过滤条件，一旦输入变化立即作废 */
function resetResult(): void {
  result.value = null;
  selected.value = new Set();
}

// 目录或过滤条件任一变化，旧结果不再可信，避免用户在过时数据上执行操作
watch([leftRoot, rightRoot, minSizeKb, includeInput, excludeInput], () => {
  resetResult();
});

const emptyText = computed(() => {
  if (!leftRoot.value || !rightRoot.value) return "先选择左右两个目录";
  if (!result.value) return "点「扫描」比较两侧";
  return "两侧内容一致";
});

/** 所有有差异的行默认勾选 */
function defaultSelection(scanned: ScanResult): Set<number> {
  const next = new Set<number>();
  scanned.rows.forEach((row, index) => {
    if (row.status === "same" || row.status === "ignored") return;
    next.add(index);
  });
  return next;
}

async function scan(forceRehash = false): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) {
    pushAlert("请先选择左右两个目录");
    return;
  }
  batchOpen.value = false;
  scanning.value = true;
  forceRehashActive.value = forceRehash;
  progressView.value = "running";
  try {
    const outcome = await window.api.scan({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      minSize: Math.max(0, Math.round(minSizeKb.value * 1024)),
      includeExts: parseExtInput(includeInput.value),
      excludeExts: parseExtInput(excludeInput.value),
      forceRehash,
    });
    if (outcome.cancelled || !outcome.result) {
      progressView.value = "cancelled";
      return;
    }
    const scanned = outcome.result;
    result.value = scanned;
    selected.value = defaultSelection(scanned);
    alerts.value = [...scanned.warnings];
    progressView.value = "hidden";
    showToast(`扫描完成：共 ${scanned.rows.length} 项`);
    await window.api.log("info", `scan rows=${scanned.rows.length} forceRehash=${forceRehash}`);
  } catch (error) {
    result.value = null;
    progressView.value = "hidden";
    pushAlert(error instanceof Error ? error.message : String(error));
  } finally {
    scanning.value = false;
    progress.value = null;
  }
}

async function pauseScan(): Promise<void> {
  await window.api.pauseScan();
  progressView.value = "paused";
}

async function resumeScan(): Promise<void> {
  await window.api.resumeScan();
  progressView.value = "running";
}

async function cancelScan(): Promise<void> {
  await window.api.cancelScan();
}

function closeProgress(): void {
  progressView.value = "hidden";
}

function toggle(index: number): void {
  const next = new Set(selected.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  selected.value = next;
}

function showToast(message: string): void {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 1500);
}

function pushAlert(message: string): void {
  if (!message || alerts.value.includes(message)) return;
  alerts.value = [...alerts.value, message];
}

function dismissAlert(index: number): void {
  alerts.value = alerts.value.filter((_, i) => i !== index);
}

/** 从动作推导受影响行的最终两侧路径，供局部刷新使用 */
function buildTargets(actions: SyncAction[]): RefreshTarget[] {
  const rows = result.value?.rows ?? [];
  const map = new Map<number, RefreshTarget>();
  for (const action of actions) {
    const row = rows[action.rowIndex];
    if (!row) continue;
    const current = map.get(action.rowIndex) ?? {
      rowIndex: action.rowIndex,
      left: row.left,
      right: row.right,
    };
    if (action.kind === "soft-delete") {
      if (action.side === "left") current.left = null;
      else current.right = null;
    } else if (action.side === "left") {
      current.left = action.toPath;
    } else {
      current.right = action.toPath;
    }
    map.set(action.rowIndex, current);
  }
  return [...map.values()];
}

function statusOf(left: RefreshedFile | null, right: RefreshedFile | null): DiffRow["status"] {
  if (left && right) {
    if (left.hash === right.hash) {
      return left.path.toLowerCase() === right.path.toLowerCase() ? "same" : "moved";
    }
    return "target-blocked";
  }
  if (left) return "left-only";
  if (right) return "right-only";
  return "ignored";
}

function recountStats(rows: DiffRow[]): ScanStats {
  const stats: ScanStats = {
    same: 0,
    moved: 0,
    duplicate: 0,
    leftOnly: 0,
    rightOnly: 0,
    ignored: 0,
  };
  for (const row of rows) {
    switch (row.status) {
      case "left-only":
        stats.leftOnly += 1;
        break;
      case "right-only":
        stats.rightOnly += 1;
        break;
      case "target-blocked":
        break;
      default:
        stats[row.status] += 1;
    }
  }
  return stats;
}

/** 局部刷新：只改受影响的行，不重扫目录 */
function applyRefresh(rows: RefreshedRow[]): void {
  const current = result.value;
  if (!current) return;
  for (const item of rows) {
    const row = current.rows[item.rowIndex];
    if (!row) continue;
    current.rows[item.rowIndex] = {
      ...row,
      left: item.left?.path ?? null,
      right: item.right?.path ?? null,
      leftHash: item.left?.hash ?? null,
      rightHash: item.right?.hash ?? null,
      status: statusOf(item.left, item.right),
    };
  }
  current.stats = recountStats(current.rows);
}

function formatStale(stale: StaleEntry[]): string {
  const names = stale
    .slice(0, 5)
    .map((item) => item.path)
    .join("、");
  const suffix = stale.length > 5 ? ` 等 ${stale.length} 个` : "";
  return `${stale.length} 个文件在扫描后已被修改，已跳过。重新扫描确认后再操作：${names}${suffix}`;
}

function formatMismatch(entries: MismatchEntry[]): string {
  const detail = entries
    .slice(0, 5)
    .map((item) => `${item.path}（预期${item.expected}，实际${item.actual}）`)
    .join("；");
  return `${entries.length} 个文件执行结果与预期不符：${detail}`;
}

async function runActions(actions: SyncAction[], label: string): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) return;
  if (actions.length === 0) {
    showToast(`${label}：没有可执行的动作`);
    return;
  }
  executing.value = true;
  try {
    const outcome = await window.api.execute({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      actions,
    });

    const targets = buildTargets(actions);
    const refreshed = targets.length
      ? await window.api.refresh({
          leftRoot: leftRoot.value,
          rightRoot: rightRoot.value,
          targets,
        })
      : [];
    applyRefresh(refreshed);

    showToast(`${label}：复制 ${outcome.copied}，改名 ${outcome.moved}，删除 ${outcome.deleted}`);

    if (outcome.stale.length > 0) {
      pushAlert(formatStale(outcome.stale));
    }
    const stalePaths = new Set(outcome.stale.map((item) => item.path));
    const executed = actions.filter((action) => !stalePaths.has(action.toPath));
    const mismatched = verifyOutcome(executed, refreshed);
    if (mismatched.length > 0) {
      pushAlert(formatMismatch(mismatched));
    }
    if (outcome.failed.length > 0) {
      pushAlert(
        outcome.failed
          .slice(0, 5)
          .map((item) => `${item.path}：${item.message}`)
          .join("；"),
      );
    }
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  } finally {
    executing.value = false;
  }
}

/** 单行操作：> 以左为准改写右侧，< 以右为准改写左侧。删除已在操作列气泡里确认过 */
function runRow(index: number, side: Side): void {
  const row = result.value?.rows[index];
  if (!row) return;
  const dirs = rowDirections(row, index);
  const target = side === "left" ? dirs.left : dirs.right;
  if (target.actions.length === 0) return;
  void runActions(target.actions, side === "left" ? "同步到左侧" : "同步到右侧");
}

/** 忽略缓存重算这一行两侧的哈希，并刷新该行状态 */
async function rehashRow(index: number): Promise<void> {
  const row = result.value?.rows[index];
  if (!row || (!row.left && !row.right)) return;
  try {
    const outcome = await window.api.rehash({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      left: row.left,
      right: row.right,
    });
    const current = result.value;
    if (current) {
      const target = current.rows[index];
      if (target) {
        const leftHash = outcome.leftHash ?? target.leftHash;
        const rightHash = outcome.rightHash ?? target.rightHash;
        let status = target.status;
        if (leftHash && rightHash) {
          const sameHash = leftHash === rightHash;
          const samePath = (target.left ?? "").toLowerCase() === (target.right ?? "").toLowerCase();
          status = sameHash ? (samePath ? "same" : "moved") : "target-blocked";
        }
        current.rows[index] = { ...target, leftHash, rightHash, status };
      }
    }
    showToast("已重算这一行");
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

async function loadRecycle(): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) return;
  recycleItems.value = await window.api.listRecycle({
    leftRoot: leftRoot.value,
    rightRoot: rightRoot.value,
  });
}

async function openRecycle(): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) {
    pushAlert("请先选择左右两个目录");
    return;
  }
  try {
    await loadRecycle();
    recycleOpen.value = true;
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

async function restoreItem(item: DeletedRecord): Promise<void> {
  const root = item.side === "left" ? leftRoot.value : rightRoot.value;
  recycleBusy.value = true;
  try {
    await window.api.restoreRecycle({ root, id: item.id });
    await loadRecycle();
    showToast(`已还原：${item.path}`);
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  } finally {
    recycleBusy.value = false;
  }
}

/** 文件右键：挂在文件列表上，不是操作列 */
function onRowMenu(side: Side, index: number, event: MouseEvent): void {
  const row = result.value?.rows[index];
  if (!row || !row[side]) return;
  event.preventDefault();
  rowMenu.value = {
    rowIndex: index,
    side,
    x: Math.min(event.clientX, window.innerWidth - 170),
    y: Math.min(event.clientY, window.innerHeight - 90),
  };
}

function requestSoftDelete(): void {
  const menu = rowMenu.value;
  rowMenu.value = null;
  if (!menu) return;
  softDeleteConfirm.value = { rowIndex: menu.rowIndex, side: menu.side };
}

async function confirmSoftDelete(): Promise<void> {
  const target = softDeleteConfirm.value;
  softDeleteConfirm.value = null;
  if (!target) return;
  const row = result.value?.rows[target.rowIndex];
  const path = row?.[target.side];
  if (!row || !path) return;
  await runActions(
    [
      {
        kind: "soft-delete",
        side: target.side,
        fromPath: null,
        toPath: path,
        status: row.status,
        rowIndex: target.rowIndex,
      },
    ],
    "软删除",
  );
}

function rehashFromMenu(): void {
  const menu = rowMenu.value;
  rowMenu.value = null;
  if (!menu) return;
  void rehashRow(menu.rowIndex);
}

function openBatch(): void {
  if (selected.value.size === 0) return;
  batchOpen.value = true;
}

/** 批量执行的动作全部按当前选择现算，不复用扫描结果 */
async function executeBatch(): Promise<void> {
  const rows = result.value?.rows ?? [];
  const side = batchTargetSide.value;
  const mode: AlignMode = batchReorder.value
    ? side === "right"
      ? "align-left"
      : "align-right"
    : "keep";
  const conflicts = batchReorder.value
    ? detectTargetConflicts(rows, selected.value, side)
    : new Set<number>();

  const actions: SyncAction[] = [];
  for (const index of [...selected.value].toSorted((a, b) => a - b)) {
    if (conflicts.has(index)) continue;
    const row = rows[index];
    if (!row) continue;
    actions.push(...actionForRow(row, side, index, mode));
  }

  batchOpen.value = false;
  await runActions(actions, "批量执行");
}
</script>

<template>
  <div class="flex h-full flex-col bg-slate-950 text-slate-200">
    <ProgressPage
      v-if="progressView !== 'hidden'"
      :progress="progress"
      :status="progressStatus"
      :force-rehash="forceRehashActive"
      @pause="pauseScan"
      @resume="resumeScan"
      @cancel="cancelScan"
      @back="closeProgress"
    />

    <RecyclePage
      v-else-if="recycleOpen"
      :items="recycleItems"
      :busy="recycleBusy"
      @restore="restoreItem"
      @close="recycleOpen = false"
    />

    <template v-else-if="!batchOpen">
      <div v-if="alerts.length > 0" class="border-b border-amber-900/60 bg-amber-950/40">
        <div
          v-for="(alert, index) in alerts"
          :key="index"
          class="flex items-start gap-3 px-4 py-1.5 text-[11px] text-amber-200"
        >
          <span class="flex-1">{{ alert }}</span>
          <button
            type="button"
            class="text-amber-400 hover:text-amber-200"
            @click="dismissAlert(index)"
          >
            ×
          </button>
        </div>
      </div>

      <header class="border-b border-slate-800 px-4 py-3">
        <div class="flex items-center gap-3">
          <DirPicker label="左侧目录" :path="leftRoot" @pick="pick('left')" />
          <DirPicker label="右侧目录" :path="rightRoot" @pick="pick('right')" />
        </div>
      </header>

      <div class="relative">
        <FilterPanel
          v-model:minSizeKb="minSizeKb"
          v-model:includeInput="includeInput"
          v-model:excludeInput="excludeInput"
          v-model:hideSame="hideSame"
          :scanning="scanning"
          :busy="busy"
          @scan="scan()"
          @force-rehash="scan(true)"
        />
      </div>

      <main class="flex min-h-0 flex-1 flex-col">
        <div
          class="flex items-center border-b border-slate-800 bg-slate-900/60 text-[11px] text-slate-400"
        >
          <div class="min-w-0 flex-1 truncate px-3 py-1.5 font-medium">
            {{ baseName(leftRoot) || "左侧文件" }}
          </div>
          <div class="w-24 shrink-0"></div>
          <div class="min-w-0 flex-1 truncate px-3 py-1.5 font-medium">
            {{ baseName(rightRoot) || "右侧文件" }}
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <div v-if="items.length === 0" class="px-3 py-12 text-center text-xs text-slate-600">
            {{ emptyText }}
          </div>
          <div v-else class="flex">
            <div class="min-w-0 flex-1">
              <FileList side="left" :items="items" @toggle="toggle" @menu="onRowMenu" />
            </div>
            <div class="w-24 shrink-0 border-x border-slate-800 bg-slate-900/30">
              <RowActions
                :items="items"
                :selected="selected"
                :busy="busy"
                @run-left="runRow($event, 'left')"
                @run-right="runRow($event, 'right')"
                @rehash="rehashRow"
                @toggle="toggle"
              />
            </div>
            <div class="min-w-0 flex-1">
              <FileList side="right" :items="items" @toggle="toggle" @menu="onRowMenu" />
            </div>
          </div>
        </div>
      </main>

      <footer class="border-t border-slate-800 px-4 py-2">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
          <span v-if="result" class="cursor-help" :title="statsTooltip"
            >待处理 {{ pendingCount }}</span
          >
          <button
            type="button"
            class="ml-auto rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            @click="openRecycle"
          >
            回收站
          </button>
          <button
            type="button"
            class="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="busy || selected.size === 0"
            :title="selected.size === 0 ? '先勾选要执行的差异行' : ''"
            @click="openBatch"
          >
            批量执行（{{ selected.size }}）
          </button>
        </div>
      </footer>
    </template>

    <BatchPage
      v-else
      :stats="batchStats"
      :baseline="batchBaseline"
      :reorder="batchReorder"
      :busy="executing"
      @update:baseline="batchBaseline = $event"
      @update:reorder="batchReorder = $event"
      @execute="executeBatch"
      @close="batchOpen = false"
    />

    <div
      v-if="rowMenu"
      class="fixed inset-0 z-40"
      @click="rowMenu = null"
      @contextmenu.prevent="rowMenu = null"
    ></div>
    <div
      v-if="rowMenu"
      class="fixed z-50 w-44 rounded border border-slate-700 bg-slate-900 py-1 text-xs shadow-xl"
      :style="{ top: `${rowMenu.y}px`, left: `${rowMenu.x}px` }"
    >
      <button
        type="button"
        class="block w-full px-3 py-1.5 text-left text-slate-300 hover:bg-slate-800"
        @click="requestSoftDelete"
      >
        软删除{{ rowMenu.side === "left" ? "左侧" : "右侧" }}文件
      </button>
      <button
        type="button"
        class="block w-full px-3 py-1.5 text-left text-slate-300 hover:bg-slate-800"
        @click="rehashFromMenu"
      >
        重算哈希
      </button>
    </div>

    <div
      v-if="softDeleteConfirm"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60"
      @click.self="softDeleteConfirm = null"
    >
      <ConfirmBubble
        floating
        title="软删除"
        :message="softDeleteMessage"
        confirm-text="移入回收站"
        danger
        @confirm="confirmSoftDelete"
        @cancel="softDeleteConfirm = null"
      />
    </div>

    <ToastBubble v-if="toast" :message="toast" />
  </div>
</template>
