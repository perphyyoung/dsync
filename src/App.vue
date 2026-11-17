<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import ConfirmBubble from "./components/ConfirmBubble.vue";
import FileList from "./components/FileList.vue";
import FilterPanel from "./components/FilterPanel.vue";
import ProgressPage from "./components/ProgressPage.vue";
import RecyclePage from "./components/RecyclePage.vue";
import RowActions from "./components/RowActions.vue";
import ScanSettingsPage from "./components/ScanSettingsPage.vue";
import ToastBubble from "./components/ToastBubble.vue";
import { pairKey, type DirPairEntry } from "./lib/dir-pairs";
import { parseExtInput } from "./lib/exts";
import { buildPreview } from "./lib/preview";
import { rowDirections } from "./lib/row-actions";
import { verifyOutcome } from "./lib/verify";
import type {
  DeletedRecord,
  DiffRow,
  FilterPrefs,
  MismatchEntry,
  RefreshTarget,
  RefreshedFile,
  RefreshedRow,
  ScanProgress,
  ScanResult,
  ScanStats,
  Side,
  SizeUnit,
  StaleEntry,
  SyncAction,
  TimeMode,
  ViewMode,
} from "./lib/types";

const leftRoot = ref("");
const rightRoot = ref("");
const sizeEnabled = ref(false);
const sizeMin = ref(0);
const sizeMax = ref(0);
const sizeMinUnit = ref<SizeUnit>("MB");
const sizeMaxUnit = ref<SizeUnit>("MB");
const maxDepth = ref(0);
const includeInput = ref("");
const excludeInput = ref("");
const excludePathsInput = ref("");
const timeMode = ref<TimeMode>("none");
const dateFrom = ref("");
const dateTo = ref("");
const recentDays = ref(0);
const skipHidden = ref(true);
const hideSame = ref(true);
const viewMode = ref<ViewMode>("all");

const scanning = ref(false);
const executing = ref(false);
const progress = ref<ScanProgress | null>(null);
const forceRehashActive = ref(false);
const progressView = ref<"hidden" | "running" | "paused" | "cancelled">("hidden");
const settingsOpen = ref(false);
const result = ref<ScanResult | null>(null);
const selected = ref<Set<number>>(new Set());
const toast = ref<string | null>(null);
const alerts = ref<string[]>([]);
let toastTimer: ReturnType<typeof setTimeout> | null = null;

const previewSide = ref<Side | null>(null);

const recycleOpen = ref(false);
const recycleItems = ref<DeletedRecord[]>([]);
const recycleBusy = ref(false);
const rowMenu = ref<{ rowIndex: number; side: Side; x: number; y: number } | null>(null);
const softDeleteConfirm = ref<{ rowIndex: number; side: Side } | null>(null);

const busy = computed(() => scanning.value || executing.value);

/* 大小过滤的单位换算在界面层做，IPC 仍传字节 */
const SIZE_UNIT_FACTORS: Record<SizeUnit, number> = {
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

/* 每个目录对一套扫描条件；目录对首次进入用默认值，左右互换命中同一组 */
const DEFAULT_FILTERS: FilterPrefs = {
  sizeEnabled: false,
  sizeMin: 0,
  sizeMax: 0,
  sizeMinUnit: "MB",
  sizeMaxUnit: "MB",
  maxDepth: 0,
  includeInput: "",
  excludeInput: "",
  excludePathsInput: "",
  timeMode: "none",
  dateFrom: "",
  dateTo: "",
  recentDays: 0,
  skipHidden: true,
};

const pairEntries = ref<DirPairEntry[]>([]);

function currentFilters(): FilterPrefs {
  return {
    sizeEnabled: sizeEnabled.value,
    sizeMin: sizeMin.value,
    sizeMax: sizeMax.value,
    sizeMinUnit: sizeMinUnit.value,
    sizeMaxUnit: sizeMaxUnit.value,
    maxDepth: maxDepth.value,
    includeInput: includeInput.value,
    excludeInput: excludeInput.value,
    excludePathsInput: excludePathsInput.value,
    timeMode: timeMode.value,
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
    recentDays: recentDays.value,
    skipHidden: skipHidden.value,
  };
}

function applyFilters(data: FilterPrefs): void {
  sizeEnabled.value = data.sizeEnabled;
  sizeMin.value = data.sizeMin;
  sizeMax.value = data.sizeMax;
  sizeMinUnit.value = data.sizeMinUnit;
  sizeMaxUnit.value = data.sizeMaxUnit;
  maxDepth.value = data.maxDepth;
  includeInput.value = data.includeInput;
  excludeInput.value = data.excludeInput;
  excludePathsInput.value = data.excludePathsInput;
  timeMode.value = data.timeMode;
  dateFrom.value = data.dateFrom;
  dateTo.value = data.dateTo;
  recentDays.value = data.recentDays;
  skipHidden.value = data.skipHidden;
}

/** 目录对变化：有存档应用存档，没有回默认（不沿用上一个目录对的条件） */
function applyPairForRoots(): void {
  if (!leftRoot.value || !rightRoot.value) return;
  const key = pairKey(leftRoot.value, rightRoot.value);
  const entry = pairEntries.value.find((item) => pairKey(item.left, item.right) === key);
  applyFilters(entry?.filters ?? DEFAULT_FILTERS);
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function savePairFiltersNow(): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) return;
  try {
    await window.api.savePairFilters({
      left: leftRoot.value,
      right: rightRoot.value,
      filters: currentFilters(),
    });
    upsertLocalPair(false);
  } catch (error) {
    void window.api.log("warn", `[pairs] 保存扫描条件失败：${String(error)}`);
  }
}

/** 本地缓存与主进程保持一致，切换目录对时才能取到刚存的条件 */
function upsertLocalPair(used: boolean): void {
  if (!leftRoot.value || !rightRoot.value) return;
  const key = pairKey(leftRoot.value, rightRoot.value);
  const existing = pairEntries.value.find((item) => pairKey(item.left, item.right) === key);
  const entry: DirPairEntry = {
    left: leftRoot.value,
    right: rightRoot.value,
    usedAt: used ? new Date().toISOString() : (existing?.usedAt ?? null),
    filters: currentFilters(),
  };
  const rest = pairEntries.value.filter((item) => pairKey(item.left, item.right) !== key);
  pairEntries.value = [entry, ...rest];
}

/** 条件变化防抖 500ms 保存；开始扫描前会强制落盘 */
function scheduleSaveFilters(): void {
  if (!leftRoot.value || !rightRoot.value) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void savePairFiltersNow();
  }, 500);
}

// 目录变化：结果作废并按目录对加载条件
watch([leftRoot, rightRoot], () => {
  resetResult();
  applyPairForRoots();
});

// 条件变化：结果作废并延迟保存
watch(
  [
    sizeEnabled,
    sizeMin,
    sizeMax,
    sizeMinUnit,
    sizeMaxUnit,
    maxDepth,
    includeInput,
    excludeInput,
    excludePathsInput,
    timeMode,
    dateFrom,
    dateTo,
    recentDays,
    skipHidden,
  ],
  () => {
    resetResult();
    scheduleSaveFilters();
  },
);

/* 切到「最近」时给个可用默认值 */
watch(timeMode, (mode) => {
  if (mode === "recent" && recentDays.value < 1) recentDays.value = 7;
});

const softDeleteMessage = computed(() => {
  const target = softDeleteConfirm.value;
  if (!target) return "";
  const row = result.value?.rows[target.rowIndex];
  const path = row?.[target.side] ?? "";
  return `${path}\n移入回收站后可以还原；dsync 不会真正删除文件。`;
});

/* 显示视角：只看左侧 / 只看右侧 / 只看重复 / 只看目标占用 */
function matchesView(row: DiffRow): boolean {
  if (viewMode.value === "left") return row.left !== null;
  if (viewMode.value === "right") return row.right !== null;
  if (viewMode.value === "duplicate") return row.status === "duplicate";
  if (viewMode.value === "blocked") return row.status === "target-blocked";
  return true;
}

const items = computed(() => {
  const rows = result.value?.rows ?? [];
  return rows
    .map((row, index) => ({ row, index }))
    .filter((item) => !hideSame.value || item.row.status !== "same")
    .filter((item) => matchesView(item.row));
});

const STAT_META: { key: keyof ScanStats; label: string; dot: string }[] = [
  { key: "same", label: "一致", dot: "bg-slate-600" },
  { key: "moved", label: "仅路径不同", dot: "bg-sky-400" },
  { key: "leftOnly", label: "仅左侧", dot: "bg-emerald-400" },
  { key: "rightOnly", label: "仅右侧", dot: "bg-emerald-400" },
  { key: "duplicateLeft", label: "重复(左)", dot: "bg-fuchsia-400" },
  { key: "duplicateRight", label: "重复(右)", dot: "bg-fuchsia-400" },
  { key: "targetBlocked", label: "目标占用", dot: "bg-rose-500" },
  { key: "ignored", label: "已忽略", dot: "bg-slate-700" },
];

const PREVIEW_OPTIONS: { value: Side; label: string }[] = [
  { value: "left", label: "向左同步预览" },
  { value: "right", label: "向右同步预览" },
];

/* 底部状态统计：只算当前列表可见的行，色点与列表一致，零值不显示 */
const statItems = computed(() => {
  const counts = recountStats(items.value.map((item) => item.row));
  return STAT_META.filter((item) => counts[item.key] > 0).map((item) => ({
    key: item.key,
    label: item.label,
    dot: item.dot,
    count: counts[item.key],
  }));
});

/* 全选只覆盖可见且参与执行的行：same 与 ignored 不勾 */
const selectableIndexes = computed(() =>
  items.value
    .filter(({ row }) => row.status !== "same" && row.status !== "ignored")
    .map(({ index }) => index),
);

const allSelected = computed(
  () =>
    selectableIndexes.value.length > 0 &&
    selectableIndexes.value.every((index) => selected.value.has(index)),
);

const someSelected = computed(
  () => !allSelected.value && selectableIndexes.value.some((index) => selected.value.has(index)),
);

function toggleAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(selectableIndexes.value);
}

const preview = computed(() => {
  const side = previewSide.value;
  if (!side) return null;
  return buildPreview(result.value?.rows ?? [], selected.value, side);
});

const progressStatus = computed<"running" | "paused" | "cancelled">(() =>
  progressView.value === "hidden" ? "running" : progressView.value,
);

let unsubscribeProgress: (() => void) | null = null;

onMounted(() => {
  unsubscribeProgress = window.api.onProgress((next) => {
    progress.value = next;
  });

  /* 先载入目录对档案，再回填目录，条件随目录对应用 */
  void (async () => {
    await loadPairEntries();
    await restoreLastPair();
  })();
  settingsOpen.value = true;
});

async function loadPairEntries(): Promise<void> {
  try {
    pairEntries.value = await window.api.listPairs();
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

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
  if (toastTimer) clearTimeout(toastTimer);
  if (saveTimer) clearTimeout(saveTimer);
});

async function pick(side: "left" | "right"): Promise<void> {
  const current = side === "left" ? leftRoot.value : rightRoot.value;
  const picked = await window.api.pickDirectory(current ?? undefined);
  if (!picked) return;
  if (side === "left") leftRoot.value = picked;
  else rightRoot.value = picked;
}

/** 从设置页的最近目录对列表回填左右目录 */
function pickPairRoots(pair: DirPairEntry): void {
  leftRoot.value = pair.left;
  rightRoot.value = pair.right;
  showToast("已载入目录对");
}

/** 删除目录对存档；当前使用中的目录对不提供删除入口 */
async function removePair(pair: DirPairEntry): Promise<void> {
  try {
    await window.api.removePair({ left: pair.left, right: pair.right });
    const key = pairKey(pair.left, pair.right);
    pairEntries.value = pairEntries.value.filter((item) => pairKey(item.left, item.right) !== key);
    showToast("已删除目录对");
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

/** 用系统文件管理器打开目录 */
async function openDir(side: "left" | "right"): Promise<void> {
  const path = side === "left" ? leftRoot.value : rightRoot.value;
  if (!path) return;
  try {
    await window.api.openDirectory(path);
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

/** 结果只对应当前目录与过滤条件，一旦输入变化立即作废 */
function resetResult(): void {
  result.value = null;
  selected.value = new Set();
  previewSide.value = null;
}

const emptyText = computed(() => {
  if (!leftRoot.value || !rightRoot.value) return "先选择左右两个目录";
  if (!result.value) return "点「扫描」设置条件并开始比较";
  return "两侧内容一致";
});

/** 路径关键词：逗号或分号分隔，大小写不敏感 */
function parseKeywordInput(input: string): string[] {
  return input
    .split(/[,;，；]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

/** 时间范围：三态互斥，只按当前模式取一侧 */
function timeWindow(): { modifiedAfter: number; modifiedBefore: number } {
  if (timeMode.value === "recent") {
    return { modifiedAfter: Date.now() - recentDays.value * 86_400_000, modifiedBefore: 0 };
  }
  if (timeMode.value === "custom") {
    const fromDate = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`).getTime() : 0;
    const toDate = dateTo.value ? new Date(`${dateTo.value}T23:59:59.999`).getTime() : 0;
    return { modifiedAfter: fromDate, modifiedBefore: toDate };
  }
  return { modifiedAfter: 0, modifiedBefore: 0 };
}

async function scan(forceRehash = false): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) {
    pushAlert("请先选择左右两个目录");
    return;
  }
  /* 只在开始扫描时校验目录：失效则留在设置页，不进进度页 */
  try {
    const [leftOk, rightOk] = await window.api.checkDirs([leftRoot.value, rightRoot.value]);
    if (!leftOk || !rightOk) {
      pushAlert(
        !leftOk
          ? `左侧目录不存在：${leftRoot.value}，请重新选择目录`
          : `右侧目录不存在：${rightRoot.value}，请重新选择目录`,
      );
      return;
    }
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
    return;
  }
  /* 先落盘条件，主进程扫描成功时只更新使用时间 */
  await savePairFiltersNow();
  settingsOpen.value = false;
  previewSide.value = null;
  scanning.value = true;
  forceRehashActive.value = forceRehash;
  progressView.value = "running";
  try {
    const outcome = await window.api.scan({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      minSize: sizeEnabled.value
        ? Math.max(0, Math.round(sizeMin.value * SIZE_UNIT_FACTORS[sizeMinUnit.value]))
        : 0,
      maxSize: sizeEnabled.value
        ? Math.max(0, Math.round(sizeMax.value * SIZE_UNIT_FACTORS[sizeMaxUnit.value]))
        : 0,
      maxDepth: Math.max(0, Math.round(maxDepth.value)),
      excludePaths: parseKeywordInput(excludePathsInput.value),
      ...timeWindow(),
      skipHidden: skipHidden.value,
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
    upsertLocalPair(true);
    selected.value = new Set();
    alerts.value = [...scanned.warnings];
    if (scanned.warnings.length > 0) {
      void window.api.log("warn", `[scan] ${scanned.warnings.join("；")}`);
    }
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
  void window.api.log("warn", `[ui] ${message}`);
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
    duplicateLeft: 0,
    duplicateRight: 0,
    leftOnly: 0,
    rightOnly: 0,
    ignored: 0,
    targetBlocked: 0,
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
        stats.targetBlocked += 1;
        break;
      case "duplicate":
        if (row.left) stats.duplicateLeft += 1;
        else stats.duplicateRight += 1;
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

  /* 本次刷新后两侧都空的行整行移除；删过行就清空勾选，避免索引错位 */
  const touched = new Set(rows.map((item) => item.rowIndex));
  const before = current.rows.length;
  current.rows = current.rows.filter(
    (row, index) => !(touched.has(index) && row.left === null && row.right === null),
  );
  if (current.rows.length !== before) selected.value = new Set();
  current.stats = recountStats(current.rows);
}

/** 还原后按增量更新或新增一行，不重扫 */
async function applyRestored(side: Side, path: string): Promise<void> {
  const current = result.value;
  if (!current || !leftRoot.value || !rightRoot.value) return;

  /* 先探一下还原文件的哈希，用于按内容找配对行 */
  const probed = await window.api.refresh({
    leftRoot: leftRoot.value,
    rightRoot: rightRoot.value,
    targets: [
      { rowIndex: 0, left: side === "left" ? path : null, right: side === "right" ? path : null },
    ],
  });
  const file = side === "left" ? probed[0]?.left : probed[0]?.right;
  if (!file) return;

  /* 本侧同路径的行，或对侧同哈希、本侧为空的行（配对行被软删除了一侧） */
  const otherHashKey = side === "left" ? "rightHash" : "leftHash";
  const index = current.rows.findIndex(
    (row) =>
      row[side]?.toLowerCase() === path.toLowerCase() ||
      (row[side] === null && row[otherHashKey] === file.hash),
  );

  if (index >= 0) {
    const row = current.rows[index];
    const refreshed = await window.api.refresh({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      targets: [
        {
          rowIndex: index,
          left: side === "left" ? path : (row?.left ?? null),
          right: side === "right" ? path : (row?.right ?? null),
        },
      ],
    });
    applyRefresh(refreshed);
    return;
  }

  current.rows = [
    ...current.rows,
    {
      status: side === "left" ? "left-only" : "right-only",
      left: side === "left" ? path : null,
      right: side === "right" ? path : null,
      leftSize: side === "left" ? file.size : null,
      rightSize: side === "right" ? file.size : null,
      leftHash: side === "left" ? file.hash : null,
      rightHash: side === "right" ? file.hash : null,
      base: null,
      pairedBy: null,
      note: null,
    },
  ];
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
    void window.api.log(
      "info",
      `[${label}] copied=${outcome.copied} moved=${outcome.moved} deleted=${outcome.deleted} ` +
        `failed=${outcome.failed.length} stale=${outcome.stale.length}`,
    );

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
    const restoredPath = await window.api.restoreRecycle({ root, id: item.id });
    await loadRecycle();
    showToast(`已还原：${item.path}`);
    await applyRestored(item.side, restoredPath);
    void window.api.log("info", `[recycle] 还原 ${item.side}:${item.path}`);
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

function startPreview(side: Side): void {
  const rows = result.value?.rows ?? [];
  if (rows.length === 0) {
    pushAlert("先扫描左右目录");
    return;
  }
  /* 只勾选当前可见的行（显示模式已锁定，进预览后不会变） */
  const visible = new Set(items.value.map((item) => item.index));
  const { actions } = buildPreview(rows, visible, side);
  selected.value = new Set(actions.map((action) => action.rowIndex));
  previewSide.value = side;
}

/** 退出预览：连同勾选一起清空 */
function exitPreview(): void {
  previewSide.value = null;
  selected.value = new Set();
}

/** 预览开关：同一方向再点一次退出，换方向直接重算 */
function togglePreview(side: Side): void {
  if (previewSide.value === side) {
    exitPreview();
    return;
  }
  startPreview(side);
}

/** 预览定型：进入预览时把动作算好并固定，执行直接落地 */
async function executePreview(): Promise<void> {
  const side = previewSide.value;
  if (!side) return;
  const built = buildPreview(result.value?.rows ?? [], selected.value, side);
  exitPreview();
  await runActions(built.actions, side === "left" ? "同步到左侧" : "同步到右侧");
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

    <div v-else class="relative flex min-h-0 flex-1 flex-col">
      <RecyclePage
        v-if="recycleOpen"
        class="min-h-0 flex-1"
        :items="recycleItems"
        :busy="recycleBusy"
        @restore="restoreItem"
        @close="recycleOpen = false"
      />

      <ScanSettingsPage
        v-else-if="settingsOpen"
        v-model:left-root="leftRoot"
        v-model:right-root="rightRoot"
        v-model:size-enabled="sizeEnabled"
        v-model:size-min="sizeMin"
        v-model:size-max="sizeMax"
        v-model:size-min-unit="sizeMinUnit"
        v-model:size-max-unit="sizeMaxUnit"
        v-model:max-depth="maxDepth"
        v-model:include-input="includeInput"
        v-model:exclude-input="excludeInput"
        v-model:exclude-paths-input="excludePathsInput"
        v-model:time-mode="timeMode"
        v-model:date-from="dateFrom"
        v-model:date-to="dateTo"
        v-model:recent-days="recentDays"
        v-model:skip-hidden="skipHidden"
        :pairs="pairEntries"
        class="min-h-0 flex-1"
        @pick="pick"
        @pick-pair="pickPairRoots"
        @remove-pair="removePair"
        @start="scan($event)"
        @close="settingsOpen = false"
      />

      <template v-else>
        <div class="relative">
          <FilterPanel
            v-model:sizeEnabled="sizeEnabled"
            v-model:sizeMin="sizeMin"
            v-model:sizeMax="sizeMax"
            v-model:sizeMinUnit="sizeMinUnit"
            v-model:sizeMaxUnit="sizeMaxUnit"
            v-model:maxDepth="maxDepth"
            v-model:includeInput="includeInput"
            v-model:excludeInput="excludeInput"
            v-model:excludePathsInput="excludePathsInput"
            v-model:timeMode="timeMode"
            v-model:dateFrom="dateFrom"
            v-model:dateTo="dateTo"
            v-model:recentDays="recentDays"
            v-model:skipHidden="skipHidden"
            v-model:hideSame="hideSame"
            v-model:viewMode="viewMode"
            :view-locked="previewSide !== null"
            :busy="busy"
            @open-settings="settingsOpen = true"
          />
        </div>

        <main class="flex min-h-0 flex-1 flex-col">
          <div
            class="flex items-center border-b border-slate-800 bg-slate-900/60 text-[11px] text-slate-400"
          >
            <div class="flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5">
              <span
                class="min-w-0 flex-1 truncate font-medium"
                :class="leftRoot ? 'text-slate-300' : 'text-slate-600'"
                :title="leftRoot ?? ''"
              >
                {{ leftRoot || "未选择左侧目录" }}
              </span>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!leftRoot"
                  title="在文件管理器中打开"
                  @click="openDir('left')"
                >
                  打开
                </button>
              </div>
            </div>
            <div v-if="previewSide !== null" class="flex w-24 shrink-0 items-center justify-center">
              <input
                type="checkbox"
                class="h-3 w-3 accent-sky-500"
                :checked="allSelected"
                :indeterminate="someSelected"
                :disabled="selectableIndexes.length === 0"
                title="全选 / 取消全选"
                @change="toggleAll"
              />
            </div>
            <div v-else class="w-24 shrink-0"></div>
            <div class="flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5">
              <span
                class="min-w-0 flex-1 truncate font-medium"
                :class="rightRoot ? 'text-slate-300' : 'text-slate-600'"
                :title="rightRoot ?? ''"
              >
                {{ rightRoot || "未选择右侧目录" }}
              </span>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!rightRoot"
                  title="在文件管理器中打开"
                  @click="openDir('right')"
                >
                  打开
                </button>
              </div>
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
                  :highlight="previewSide"
                  :show-checkbox="previewSide !== null"
                  @run-left="runRow($event, 'left')"
                  @run-right="runRow($event, 'right')"
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
            <div v-if="statItems.length > 0" class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span v-for="item in statItems" :key="item.key" class="flex items-center gap-1">
                <span class="h-1.5 w-1.5 rounded-full" :class="item.dot"></span>
                {{ item.label }} {{ item.count }}
              </span>
            </div>

            <div class="ml-auto flex flex-wrap items-center gap-2">
              <template v-if="previewSide !== null">
                <span class="text-slate-300">
                  复制 {{ preview?.stats.copy ?? 0 }} · 改名 {{ preview?.stats.rename ?? 0 }} ·
                  软删除 {{ preview?.stats.softDelete ?? 0 }} · 忽略
                  {{ preview?.stats.ignored ?? 0 }}
                </span>
                <button
                  type="button"
                  class="rounded bg-rose-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="busy || !preview || preview.actions.length === 0"
                  @click="executePreview"
                >
                  执行同步
                </button>
              </template>

              <button
                v-for="option in PREVIEW_OPTIONS"
                :key="option.value"
                type="button"
                class="min-w-24 rounded border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                :class="
                  previewSide === option.value
                    ? 'border-sky-600 bg-sky-600/20 text-sky-300'
                    : 'border-slate-700 text-slate-300 hover:bg-slate-800'
                "
                :disabled="busy || !result"
                @click="togglePreview(option.value)"
              >
                {{ previewSide === option.value ? "退出预览" : option.label }}
              </button>

              <button
                type="button"
                class="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                @click="openRecycle"
              >
                回收站
              </button>
            </div>
          </div>
        </footer>
      </template>

      <div v-if="alerts.length > 0" class="pointer-events-none absolute inset-x-0 top-0 z-40">
        <div class="pointer-events-auto border-b border-amber-900/60 bg-amber-950/95 shadow-lg">
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
      </div>
    </div>

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
        软删除
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
