<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import ConfirmDialog from "./components/ConfirmDialog.vue";
import DirPicker from "./components/DirPicker.vue";
import FileList from "./components/FileList.vue";
import FilterPanel from "./components/FilterPanel.vue";
import RowActions from "./components/RowActions.vue";
import { parseExtInput } from "./lib/exts";
import type { ScanProgress } from "./lib/pipeline";
import { rowDirections } from "./lib/row-actions";
import type { AlignMode, Direction, ScanResult, Side, SyncAction } from "./lib/types";

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
const direction = ref<Direction>("left-to-right");
const align = ref<AlignMode>("keep");
const minSizeKb = ref(0);
const includeInput = ref("");
const excludeInput = ref("");
const ignoreCache = ref(false);
const hideSame = ref(true);

const scanning = ref(false);
const executing = ref(false);
const progress = ref<ScanProgress | null>(null);
const result = ref<ScanResult | null>(null);
const errorMessage = ref("");
const statusMessage = ref("");
const selected = ref<Set<number>>(new Set());
const dialog = ref<DialogState | null>(null);

const busy = computed(() => scanning.value || executing.value);

const items = computed(() => {
  const rows = result.value?.rows ?? [];
  return rows
    .map((row, index) => ({ row, index }))
    .filter((item) => !hideSame.value || item.row.status !== "same");
});

const batchActions = computed(() =>
  (result.value?.actions ?? []).filter((action) => selected.value.has(action.rowIndex)),
);

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

/** 所有有差异的行默认勾选，与当前方向设置无关 */
function defaultSelection(scanned: ScanResult): Set<number> {
  const next = new Set<number>();
  scanned.rows.forEach((row, index) => {
    if (row.status === "same" || row.status === "ignored" || row.status === "target-blocked")
      return;
    next.add(index);
  });
  return next;
}

async function scan(): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) {
    errorMessage.value = "请先选择左右两个目录";
    return;
  }
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
      direction: direction.value,
      align: align.value,
      ignoreCache: ignoreCache.value,
    });
    result.value = scanned;
    selected.value = defaultSelection(scanned);
    statusMessage.value = `扫描完成：共 ${scanned.rows.length} 项`;
    await window.api.log(
      "info",
      `scan rows=${scanned.rows.length} actions=${scanned.actions.length}`,
    );
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

function selectAll(): void {
  if (!result.value) return;
  selected.value = defaultSelection(result.value);
}

function clearSelection(): void {
  selected.value = new Set();
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

/** 单行操作：→ 以左为准改写右侧，← 以右为准改写左侧；涉及删除时先确认 */
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

function requestBatch(): void {
  const actions = batchActions.value;
  if (actions.length === 0) return;

  const copied = actions.filter((action) => action.kind === "copy").length;
  const moved = actions.filter((action) => action.kind === "move").length;
  const deleted = actions.filter((action) => action.kind === "delete").length;
  const toRight = new Set(
    actions.filter((action) => action.side === "right").map((action) => action.rowIndex),
  ).size;
  const toLeft = new Set(
    actions.filter((action) => action.side === "left").map((action) => action.rowIndex),
  ).size;

  const lines = [
    `以左侧为准同步到右侧：${toRight} 项`,
    `以右侧为准同步到左侧：${toLeft} 项`,
    `复制 ${copied} 个 · 改名 ${moved} 个 · 删除 ${deleted} 个`,
  ];
  if (deleted > 0) lines.push(`${deleted} 个文件会删除到回收站，可从回收站还原。`);

  dialog.value = {
    title: "确认批量执行",
    lines,
    confirmText: "执行",
    danger: deleted > 0,
    onConfirm: () => void runActions(actions, "批量执行"),
  };
}

function confirmDialog(): void {
  const current = dialog.value;
  dialog.value = null;
  current?.onConfirm();
}

const stats = computed(() => result.value?.stats ?? null);
const warnings = computed(() => result.value?.warnings ?? []);
</script>

<template>
  <div class="flex h-full flex-col bg-slate-950 text-slate-200">
    <header class="border-b border-slate-800 px-4 py-3">
      <div class="flex items-end gap-3">
        <DirPicker label="左侧目录" :path="leftRoot" @pick="pick('left')" />
        <DirPicker label="右侧目录" :path="rightRoot" @pick="pick('right')" />

        <label class="flex w-36 flex-col gap-1">
          <span class="text-[11px] tracking-wide text-slate-500 uppercase">内容方向</span>
          <select
            v-model="direction"
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
            title="决定批量执行时往哪一侧写"
          >
            <option value="none">不比对内容</option>
            <option value="left-to-right">左 → 右</option>
            <option value="right-to-left">右 → 左</option>
          </select>
        </label>

        <label class="flex w-36 flex-col gap-1">
          <span class="text-[11px] tracking-wide text-slate-500 uppercase">结构基准</span>
          <select
            v-model="align"
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
            title="决定批量执行时是否按一侧改写路径"
          >
            <option value="keep">各自保留</option>
            <option value="align-left">以左为准</option>
            <option value="align-right">以右为准</option>
          </select>
        </label>

        <button
          type="button"
          class="rounded bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy"
          @click="scan"
        >
          {{ scanning ? "扫描中…" : "扫描" }}
        </button>
      </div>
    </header>

    <FilterPanel
      v-model:minSizeKb="minSizeKb"
      v-model:includeInput="includeInput"
      v-model:excludeInput="excludeInput"
      v-model:ignoreCache="ignoreCache"
      v-model:hideSame="hideSame"
    />

    <div v-if="progressText" class="border-b border-slate-800 px-4 py-1 text-[11px] text-sky-400">
      {{ progressText }}
    </div>

    <main class="flex min-h-0 flex-1 flex-col">
      <div
        class="flex items-center border-b border-slate-800 bg-slate-900/60 text-[11px] text-slate-400"
      >
        <div class="min-w-0 flex-1 px-3 py-1.5 font-medium">左侧文件</div>
        <div class="w-24 shrink-0 text-center font-medium">操作</div>
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
        <template v-if="stats">
          <span>一致 {{ stats.same }}</span>
          <span class="text-sky-400">仅路径 {{ stats.moved }}</span>
          <span class="text-amber-400">差异 {{ stats.diff }}</span>
          <span class="text-emerald-400">仅左 {{ stats.leftOnly }}</span>
          <span class="text-emerald-400">仅右 {{ stats.rightOnly }}</span>
          <span>忽略 {{ stats.ignored }}</span>
          <span v-if="stats.blocked > 0" class="text-rose-400">阻断 {{ stats.blocked }}</span>
        </template>
        <span class="text-slate-600">|</span>
        <button type="button" class="hover:text-sky-300" @click="selectAll">全选差异</button>
        <button type="button" class="hover:text-sky-300" @click="clearSelection">清空选择</button>
        <span class="ml-auto text-slate-500">{{ statusMessage }}</span>
        <button
          type="button"
          class="rounded bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || batchActions.length === 0"
          :title="batchActions.length === 0 ? '先选择内容方向，再勾选要执行的行' : ''"
          @click="requestBatch"
        >
          {{ executing ? "执行中…" : `批量执行（${batchActions.length}）` }}
        </button>
      </div>
    </footer>

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
