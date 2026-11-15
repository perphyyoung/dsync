<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import BatchPage from "./components/BatchPage.vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import DirPicker from "./components/DirPicker.vue";
import FileList from "./components/FileList.vue";
import FilterPanel from "./components/FilterPanel.vue";
import RowActions from "./components/RowActions.vue";
import { computeBatchStats, detectTargetConflicts } from "./lib/batch";
import { parseExtInput } from "./lib/exts";
import type { ScanProgress } from "./lib/pipeline";
import { actionForRow } from "./lib/plan";
import { rowDirections } from "./lib/row-actions";
import type { AlignMode, BatchStats, ScanResult, Side, SyncAction } from "./lib/types";

interface DialogState {
  title: string;
  lines: string[];
  confirmText: string;
  danger: boolean;
  onConfirm: () => void;
}

const PHASE_LABEL: Record<ScanProgress["phase"], string> = {
  scan: "扫描目录",
  hash: "计算哈希",
  pair: "配对",
  index: "写入索引",
};

const leftRoot = ref("");
const rightRoot = ref("");
const minSizeKb = ref(0);
const includeInput = ref("");
const excludeInput = ref("");
const hideSame = ref(true);

const scanning = ref(false);
const executing = ref(false);
const progress = ref<ScanProgress | null>(null);
const result = ref<ScanResult | null>(null);
const errorMessage = ref("");
const statusMessage = ref("");
const selected = ref<Set<number>>(new Set());
const dialog = ref<DialogState | null>(null);

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

const progressText = computed(() => {
  const current = progress.value;
  if (!current) return "";
  const label = PHASE_LABEL[current.phase];
  if (current.total <= 0) return `${label}…`;
  const percent = Math.round((current.done / current.total) * 100);
  return `${label} ${percent}% (${current.done}/${current.total})`;
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
    void scan();
  });

  void restoreLastPair();
});

/** 启动时直接回填上次的目录对并比较一次 */
async function restoreLastPair(): Promise<void> {
  try {
    const recent = await window.api.listRecent();
    const last = recent[0];
    if (!last) return;
    leftRoot.value = last.left;
    rightRoot.value = last.right;
    await scan();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  }
}

onUnmounted(() => {
  unsubscribeProgress?.();
  unsubscribeRecent?.();
});

async function pick(side: "left" | "right"): Promise<void> {
  const picked = await window.api.pickDirectory();
  if (!picked) return;
  if (side === "left") leftRoot.value = picked;
  else rightRoot.value = picked;
}

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
    errorMessage.value = "请先选择左右两个目录";
    return;
  }
  batchOpen.value = false;
  scanning.value = true;
  errorMessage.value = "";
  statusMessage.value = "";
  try {
    const scanned = await window.api.scan({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      minSize: Math.max(0, Math.round(minSizeKb.value * 1024)),
      includeExts: parseExtInput(includeInput.value),
      excludeExts: parseExtInput(excludeInput.value),
      forceRehash,
    });
    result.value = scanned;
    selected.value = defaultSelection(scanned);
    statusMessage.value = `扫描完成：共 ${scanned.rows.length} 项`;
    await window.api.log("info", `scan rows=${scanned.rows.length} forceRehash=${forceRehash}`);
  } catch (error) {
    result.value = null;
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    scanning.value = false;
    progress.value = null;
  }
}

function toggle(index: number): void {
  const next = new Set(selected.value);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  selected.value = next;
}

async function runActions(actions: SyncAction[], label: string): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) return;
  if (actions.length === 0) {
    statusMessage.value = `${label}：没有可执行的动作`;
    return;
  }
  executing.value = true;
  errorMessage.value = "";
  try {
    const outcome = await window.api.execute({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      actions,
    });
    statusMessage.value =
      `${label}：复制 ${outcome.copied}，改名 ${outcome.moved}，` +
      `删除 ${outcome.deleted}，失败 ${outcome.failed.length}`;
    if (outcome.failed.length > 0) {
      errorMessage.value = outcome.failed
        .slice(0, 5)
        .map((item) => `${item.path}：${item.message}`)
        .join("；");
    }
    await scan();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : String(error);
  } finally {
    executing.value = false;
  }
}

function describeAction(action: SyncAction): string {
  if (action.kind === "copy") return `复制 ${action.fromPath ?? ""} → ${action.toPath}`;
  if (action.kind === "move") return `改名 ${action.fromPath ?? ""} → ${action.toPath}`;
  return `删除到回收站：${action.toPath}`;
}

/** 单行操作：> 以左为准改写右侧，< 以右为准改写左侧；涉及删除时先确认 */
function runRow(index: number, side: Side): void {
  const row = result.value?.rows[index];
  if (!row) return;
  const dirs = rowDirections(row, index);
  const target = side === "left" ? dirs.left : dirs.right;
  if (target.actions.length === 0) return;

  if (target.deletes) {
    const lines = target.actions.map(describeAction);
    lines.push("删除的文件可以从回收站还原。");
    dialog.value = {
      title: "确认删除",
      lines,
      confirmText: "删除",
      danger: true,
      onConfirm: () => void runActions(target.actions, "删除"),
    };
    return;
  }

  void runActions(target.actions, side === "left" ? "同步到左侧" : "同步到右侧");
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

function confirmDialog(): void {
  const current = dialog.value;
  dialog.value = null;
  current?.onConfirm();
}

const warnings = computed(() => result.value?.warnings ?? []);
</script>

<template>
  <div class="flex h-full flex-col bg-slate-950 text-slate-200">
    <template v-if="!batchOpen">
      <header class="border-b border-slate-800 px-4 py-3">
        <div class="flex items-center gap-3">
          <DirPicker label="左侧目录" :path="leftRoot" @pick="pick('left')" />
          <DirPicker label="右侧目录" :path="rightRoot" @pick="pick('right')" />
        </div>
      </header>

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

      <div v-if="progressText" class="border-b border-slate-800 px-4 py-1 text-[11px] text-sky-400">
        {{ progressText }}
      </div>

      <main class="flex min-h-0 flex-1 flex-col">
        <div
          class="flex items-center border-b border-slate-800 bg-slate-900/60 text-[11px] text-slate-400"
        >
          <div class="min-w-0 flex-1 px-3 py-1.5 font-medium">左侧文件</div>
          <div class="w-24 shrink-0"></div>
          <div class="min-w-0 flex-1 px-3 py-1.5 font-medium">右侧文件</div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto">
          <div v-if="items.length === 0" class="px-3 py-12 text-center text-xs text-slate-600">
            暂无差异，选择两个目录后点「扫描」
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
        <div v-if="warnings.length > 0" class="mb-1 text-[11px] text-amber-400">
          {{ warnings.join("；") }}
        </div>
        <div v-if="errorMessage" class="mb-1 text-[11px] text-rose-400">{{ errorMessage }}</div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-400">
          <span v-if="result" class="cursor-help" :title="statsTooltip"
            >待处理 {{ pendingCount }}</span
          >
          <span class="ml-auto text-slate-500">{{ statusMessage }}</span>
          <button
            type="button"
            class="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="busy || selected.size === 0"
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

    <ConfirmDialog
      v-if="dialog"
      :title="dialog.title"
      :lines="dialog.lines"
      :confirm-text="dialog.confirmText"
      :danger="dialog.danger"
      @confirm="confirmDialog"
      @cancel="dialog = null"
    />
  </div>
</template>
