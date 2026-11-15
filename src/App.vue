<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import BatchPage from "./components/BatchPage.vue";
import DirPicker from "./components/DirPicker.vue";
import FileList from "./components/FileList.vue";
import FilterPanel from "./components/FilterPanel.vue";
import ProgressPage from "./components/ProgressPage.vue";
import RowActions from "./components/RowActions.vue";
import ToastBubble from "./components/ToastBubble.vue";
import { computeBatchStats, detectTargetConflicts } from "./lib/batch";
import { parseExtInput } from "./lib/exts";
import { baseName } from "./lib/format";
import { actionForRow } from "./lib/plan";
import { rowDirections } from "./lib/row-actions";
import type {
  AlignMode,
  BatchStats,
  ScanProgress,
  ScanResult,
  Side,
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

const busy = computed(() => scanning.value || executing.value);

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
    `一致 ${stats.same} · 仅路径 ${stats.moved} · 差异 ${stats.diff} · ` +
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

/** 静默刷新：执行完自动对齐数据，不抢全屏，只显示过滤行下沿的细条 */
const inlineVisible = computed(() => scanning.value && progressView.value === "hidden");

const inlineIndeterminate = computed(() => {
  const current = progress.value;
  return !current || current.total <= 0;
});

const inlinePercent = computed(() => {
  const current = progress.value;
  if (!current || current.total <= 0) return 30;
  return Math.min(100, Math.round((current.done / current.total) * 100));
});

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

async function scan(forceRehash = false, silent = false): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) {
    pushAlert("请先选择左右两个目录");
    return;
  }
  batchOpen.value = false;
  scanning.value = true;
  forceRehashActive.value = forceRehash;
  if (!silent) progressView.value = "running";
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
    if (!silent) showToast(`扫描完成：共 ${scanned.rows.length} 项`);
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
    await scan(false, true);
    showToast(`${label}：复制 ${outcome.copied}，改名 ${outcome.moved}，删除 ${outcome.deleted}`);
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
          status = sameHash ? (samePath ? "same" : "moved") : "diff";
        }
        current.rows[index] = { ...target, leftHash, rightHash, status };
      }
    }
    showToast("已重算这一行");
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
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

        <Transition
          enter-active-class="transition-opacity duration-150"
          enter-from-class="opacity-0"
          leave-active-class="transition-opacity duration-200"
          leave-to-class="opacity-0"
        >
          <div
            v-if="inlineVisible"
            class="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-0.5 bg-slate-800"
          >
            <div
              class="h-full bg-sky-500 transition-all duration-300"
              :class="inlineIndeterminate ? 'w-1/3 animate-pulse' : ''"
              :style="inlineIndeterminate ? undefined : { width: `${inlinePercent}%` }"
            ></div>
          </div>
        </Transition>
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
              <FileList side="left" :items="items" @toggle="toggle" />
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
              <FileList side="right" :items="items" @toggle="toggle" />
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
            class="ml-auto rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
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

    <ToastBubble v-if="toast" :message="toast" />
  </div>
</template>
