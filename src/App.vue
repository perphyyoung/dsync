<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import AppSettingsDialog from "./components/AppSettingsDialog.vue";
import ConfirmBubble from "./components/ConfirmBubble.vue";
import ExecuteProgressWindow from "./components/ExecuteProgressWindow.vue";
import FileList from "./components/FileList.vue";
import FilterPanel from "./components/FilterPanel.vue";
import ProgressPage from "./components/ProgressPage.vue";
import RecyclePage from "./components/RecyclePage.vue";
import RowActions from "./components/RowActions.vue";
import ScanFilterLine from "./components/ScanFilterLine.vue";
import ScanSettingsPage from "./components/ScanSettingsPage.vue";
import ToastBubble from "./components/ToastBubble.vue";
import ViewModeLine from "./components/ViewModeLine.vue";
import { pairKey, type DirPairEntry } from "./lib/dir-pairs";
import { matchesDisplayFilter, type DisplayFilter } from "./lib/display-filter";
import { findWiderReasons, type ScanScope } from "./lib/display-scope";
import { parseExtInput } from "./lib/exts";
import { mirrorScanResult } from "./lib/mirror";
import { buildPreview, previewKindRows, type PreviewKind } from "./lib/preview";
import { rowDirections } from "./lib/row-actions";
import { sortItems, type SortDir, type SortKey } from "./lib/sort";
import { resolveTimeWindow } from "./lib/time-window";
import { verifyOutcome } from "./lib/verify";
import type {
  AppSettings,
  DeletedRecord,
  DiffRow,
  ExecuteProgress,
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
const includeKeywordInput = ref("");
const excludeKeywordInput = ref("");
const timeMode = ref<TimeMode>("none");
const dateFrom = ref("");
const dateTo = ref("");
const recentDays = ref(0);
const skipHidden = ref(true);
const hideSame = ref(true);
const viewMode = ref<ViewMode>("all");

/* 显示过滤：只作用于列表，不进入扫描条件，也不持久化 */
const displayKeywordMode = ref<"include" | "exclude">("include");
const displayKeywordInput = ref("");
const displaySuffixMode = ref<"include" | "exclude">("include");
const displaySuffixInput = ref("");
const displayDateFrom = ref("");
const displayDateTo = ref("");
const displaySizeMin = ref(0);
const displaySizeMax = ref(0);
const displaySizeMinUnit = ref<SizeUnit>("MB");
const displaySizeMaxUnit = ref<SizeUnit>("MB");
const displayDepth = ref(0);
const displaySkipHidden = ref(true);

const scanning = ref(false);
const executing = ref(false);
const progress = ref<ScanProgress | null>(null);

/* 执行进度窗：动作级进度 + 当前大文件字节进度 */
const execVisible = ref(false);
const execMinimized = ref(false);
const execState = ref<"running" | "paused" | "cancelled" | "done">("running");
const execProgress = ref<ExecuteProgress | null>(null);
const execSummary = ref("");
const execFailures = ref<SyncAction[]>([]);
/** 复制限速（MB/s），0 表示不限；本会话有效 */
const execRateLimit = ref(0);
let execShowTimer: ReturnType<typeof setTimeout> | null = null;
let execHideTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeExecuteProgress: (() => void) | null = null;
const forceRehashActive = ref(false);
const progressView = ref<"hidden" | "running" | "paused" | "cancelled">("hidden");
const settingsOpen = ref(false);
const settingsDialogOpen = ref(false);
const scanThreads = ref(1);
const scanThreadsAuto = ref(true);
const logicalProcessors = ref(1);
const result = ref<ScanResult | null>(null);
const selected = ref<Set<number>>(new Set());
const toast = ref<string | null>(null);
interface AlertItem {
  message: string;
  /** 执行失败时可直接重试的动作 */
  retry?: SyncAction[];
}
const alerts = ref<AlertItem[]>([]);
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
  includeKeywordInput: "",
  excludeKeywordInput: "",
  timeMode: "none",
  dateFrom: "",
  dateTo: "",
  recentDays: 0,
  skipHidden: true,
};

const pairEntries = ref<DirPairEntry[]>([]);

/* 扫描过滤行使用的条件快照：只在扫描成功后更新 */
const scannedFilters = ref<FilterPrefs>({ ...DEFAULT_FILTERS });

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
    includeKeywordInput: includeKeywordInput.value,
    excludeKeywordInput: excludeKeywordInput.value,
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
  includeKeywordInput.value = data.includeKeywordInput;
  excludeKeywordInput.value = data.excludeKeywordInput;
  timeMode.value = data.timeMode;
  dateFrom.value = data.dateFrom;
  dateTo.value = data.dateTo;
  recentDays.value = data.recentDays;
  skipHidden.value = data.skipHidden;
  scannedFilters.value = { ...data };
}

/** 目录对变化：有存档应用存档，没有回默认（不沿用上一个目录对的条件） */
function applyPairForRoots(): void {
  if (!leftRoot.value || !rightRoot.value) return;
  const key = pairKey(leftRoot.value, rightRoot.value);
  const entry = pairEntries.value.find((item) => pairKey(item.left, item.right) === key);
  applyFilters(entry?.filters ?? DEFAULT_FILTERS);
}

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

/** 条件变化不再作废结果、也不再自动保存；等点击「开始扫描」才落盘 */
// 目录变化：结果作废并按目录对加载条件；互换时结果由 swapRoots 直接镜像
let swappingRoots = false;
watch([leftRoot, rightRoot], () => {
  if (swappingRoots) {
    swappingRoots = false;
    return;
  }
  resetResult();
  applyPairForRoots();
});

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

/* 显示视角：全部 / 左侧 / 右侧 / 重复 / 占用 / 特殊（符号链接、特殊文件、读取失败） */
function matchesView(row: DiffRow): boolean {
  if (viewMode.value === "special") return row.status === "ignored";
  if (row.status === "ignored") return false;
  if (viewMode.value === "left") return row.left !== null;
  if (viewMode.value === "right") return row.right !== null;
  if (viewMode.value === "duplicate") return row.status === "duplicate";
  if (viewMode.value === "blocked") return row.status === "target-blocked";
  return true;
}

const items = computed(() => {
  const rows = result.value?.rows ?? [];
  const filtered = rows
    .map((row, index) => ({ row, index }))
    .filter((item) => !hideSame.value || item.row.status !== "same")
    .filter((item) => matchesView(item.row))
    .filter((item) => matchesDisplayFilter(item.row, displayFilter.value));
  const state = sortState.value;
  return state ? sortItems(filtered, state.key, state.dir) : filtered;
});

/* 显示过滤：界面状态换算成过滤器，只作用于列表 */
const displayFilter = computed<DisplayFilter>(() => ({
  keywordMode: displayKeywordMode.value,
  keyword: displayKeywordInput.value.trim(),
  suffixMode: displaySuffixMode.value,
  suffixes: parseExtInput(displaySuffixInput.value),
  dateFrom: displayDateFrom.value,
  dateTo: displayDateTo.value,
  sizeMin: Math.max(
    0,
    Math.round(displaySizeMin.value * SIZE_UNIT_FACTORS[displaySizeMinUnit.value]),
  ),
  sizeMax: Math.max(
    0,
    Math.round(displaySizeMax.value * SIZE_UNIT_FACTORS[displaySizeMaxUnit.value]),
  ),
  depth: Math.max(0, Math.round(displayDepth.value)),
  skipHidden: displaySkipHidden.value,
}));

/* 扫描条件里与显示范围相关的部分，用于判断显示是否超出扫描 */
const scanScope = computed<ScanScope>(() => ({
  minSize: sizeEnabled.value
    ? Math.max(0, Math.round(sizeMin.value * SIZE_UNIT_FACTORS[sizeMinUnit.value]))
    : 0,
  maxSize: sizeEnabled.value
    ? Math.max(0, Math.round(sizeMax.value * SIZE_UNIT_FACTORS[sizeMaxUnit.value]))
    : 0,
  modifiedAfter: timeWindow().modifiedAfter,
  modifiedBefore: timeWindow().modifiedBefore,
  skipHidden: skipHidden.value,
  excludeKeyword: excludeKeywordInput.value,
}));

interface DisplaySnapshot {
  keywordMode: "include" | "exclude";
  keywordInput: string;
  suffixMode: "include" | "exclude";
  suffixInput: string;
  dateFrom: string;
  dateTo: string;
  sizeMin: number;
  sizeMax: number;
  sizeMinUnit: SizeUnit;
  sizeMaxUnit: SizeUnit;
  depth: number;
  skipHidden: boolean;
}

interface WiderNotice {
  reasons: { key: string; label: string }[];
  before: DisplaySnapshot;
}

const widerNotice = ref<WiderNotice | null>(null);
let announcedWider = "";

function currentDisplaySnapshot(): DisplaySnapshot {
  return {
    keywordMode: displayKeywordMode.value,
    keywordInput: displayKeywordInput.value,
    suffixMode: displaySuffixMode.value,
    suffixInput: displaySuffixInput.value,
    dateFrom: displayDateFrom.value,
    dateTo: displayDateTo.value,
    sizeMin: displaySizeMin.value,
    sizeMax: displaySizeMax.value,
    sizeMinUnit: displaySizeMinUnit.value,
    sizeMaxUnit: displaySizeMaxUnit.value,
    depth: displayDepth.value,
    skipHidden: displaySkipHidden.value,
  };
}

let lastDisplaySnapshot = currentDisplaySnapshot();

function applyDisplaySnapshot(snapshot: DisplaySnapshot): void {
  displayKeywordMode.value = snapshot.keywordMode;
  displayKeywordInput.value = snapshot.keywordInput;
  displaySuffixMode.value = snapshot.suffixMode;
  displaySuffixInput.value = snapshot.suffixInput;
  displayDateFrom.value = snapshot.dateFrom;
  displayDateTo.value = snapshot.dateTo;
  displaySizeMin.value = snapshot.sizeMin;
  displaySizeMax.value = snapshot.sizeMax;
  displaySizeMinUnit.value = snapshot.sizeMinUnit;
  displaySizeMaxUnit.value = snapshot.sizeMaxUnit;
  displayDepth.value = snapshot.depth;
  displaySkipHidden.value = snapshot.skipHidden;
}

/* 显示条件变化：超出扫描范围时弹提醒，同一原因组合只弹一次 */
watch(
  [
    displayKeywordMode,
    displayKeywordInput,
    displaySuffixMode,
    displaySuffixInput,
    displayDateFrom,
    displayDateTo,
    displaySizeMin,
    displaySizeMax,
    displaySizeMinUnit,
    displaySizeMaxUnit,
    displayDepth,
    displaySkipHidden,
  ],
  () => {
    const previous = lastDisplaySnapshot;
    lastDisplaySnapshot = currentDisplaySnapshot();
    const reasons = findWiderReasons(displayFilter.value, scanScope.value);
    const signature = reasons.map((reason) => reason.key).join(",");
    if (!signature) {
      announcedWider = "";
      return;
    }
    if (signature === announcedWider) return;
    announcedWider = signature;
    widerNotice.value = { reasons, before: previous };
  },
);

const widerMessage = computed(() => {
  const notice = widerNotice.value;
  if (!notice) return "";
  const lines = notice.reasons.map((reason) => `· ${reason.label}`).join("\n");
  return `以下显示条件需要重新扫描才能看到：\n${lines}\n当前结果已保留；还原修改会恢复本次改动。`;
});

function restoreDisplayNotice(): void {
  const notice = widerNotice.value;
  widerNotice.value = null;
  if (notice) applyDisplaySnapshot(notice.before);
}

function rescanFromNotice(): void {
  widerNotice.value = null;
  settingsOpen.value = true;
}

/** 重置显示过滤行；不影响扫描条件与显示模式行 */
function resetDisplayFilter(): void {
  displayKeywordMode.value = "include";
  displayKeywordInput.value = "";
  displaySuffixMode.value = "include";
  displaySuffixInput.value = "";
  displayDateFrom.value = "";
  displayDateTo.value = "";
  displaySizeMin.value = 0;
  displaySizeMax.value = 0;
  displaySizeMinUnit.value = "MB";
  displaySizeMaxUnit.value = "MB";
  displayDepth.value = 0;
  displaySkipHidden.value = true;
  announcedWider = "";
  showToast("已重置显示条件");
}

/* 点击列头三态循环：默认 → 升序 → 降序 → 默认；空值排末尾 */
interface SortState {
  key: SortKey;
  dir: SortDir;
}

const sortState = ref<SortState | null>(null);

function toggleSort(key: SortKey): void {
  if (!sortState.value || sortState.value.key !== key) {
    sortState.value = { key, dir: "asc" };
    return;
  }
  if (sortState.value.dir === "asc") {
    sortState.value = { key, dir: "desc" };
    return;
  }
  sortState.value = null;
}

function sortArrow(key: SortKey): string {
  if (sortState.value?.key !== key) return "";
  return sortState.value.dir === "asc" ? "↑" : "↓";
}

const STAT_META: { key: keyof ScanStats; label: string; dot: string }[] = [
  { key: "same", label: "一致", dot: "bg-slate-600" },
  { key: "moved", label: "仅路径不同", dot: "bg-sky-400" },
  { key: "leftOnly", label: "仅左侧", dot: "bg-emerald-400" },
  { key: "rightOnly", label: "仅右侧", dot: "bg-emerald-400" },
  { key: "duplicateLeft", label: "重复(左)", dot: "bg-fuchsia-400" },
  { key: "duplicateRight", label: "重复(右)", dot: "bg-fuchsia-400" },
  { key: "targetBlocked", label: "目标占用", dot: "bg-rose-500" },
  { key: "ignored", label: "特殊", dot: "bg-slate-700" },
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

const PREVIEW_KINDS: { kind: PreviewKind; label: string }[] = [
  { kind: "copy", label: "复制" },
  { kind: "rename", label: "改名" },
  { kind: "softDelete", label: "软删除" },
];

/* 预览统计的批量开关：全选状态下每一类动作涉及的行 */
const previewKindGroups = computed(() =>
  previewSide.value ? previewKindRows(result.value?.rows ?? [], previewSide.value) : null,
);

const previewKindState = computed(() =>
  PREVIEW_KINDS.map(({ kind, label }) => {
    const indexes = previewKindGroups.value?.[kind] ?? [];
    const picked = indexes.filter((index) => selected.value.has(index)).length;
    return {
      kind,
      label,
      count: preview.value?.stats[kind] ?? 0,
      total: indexes.length,
      picked,
    };
  }),
);

function togglePreviewKind(kind: PreviewKind): void {
  const indexes = previewKindGroups.value?.[kind] ?? [];
  if (indexes.length === 0) return;
  const allIn = indexes.every((index) => selected.value.has(index));
  const next = new Set(selected.value);
  for (const index of indexes) {
    if (allIn) next.delete(index);
    else next.add(index);
  }
  selected.value = next;
}

const progressStatus = computed<"running" | "paused" | "cancelled">(() =>
  progressView.value === "hidden" ? "running" : progressView.value,
);

let unsubscribeProgress: (() => void) | null = null;

onMounted(() => {
  unsubscribeProgress = window.api.onProgress((next) => {
    progress.value = next;
  });
  unsubscribeExecuteProgress = window.api.onExecuteProgress((next) => {
    execProgress.value = next;
  });

  /* 先载入目录对档案，再回填目录，条件随目录对应用 */
  void (async () => {
    await loadPairEntries();
    await restoreLastPair();
  })();
  void loadAppSettings();
  settingsOpen.value = true;
});

function applyAppSettings(next: AppSettings): void {
  scanThreads.value = next.scanThreads;
  scanThreadsAuto.value = next.scanThreadsAuto;
  logicalProcessors.value = next.logicalProcessors;
}

async function loadAppSettings(): Promise<void> {
  try {
    applyAppSettings(await window.api.getAppSettings());
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

async function saveScanThreads(value: number): Promise<void> {
  try {
    applyAppSettings(await window.api.setScanThreads(value));
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

async function resetScanThreads(): Promise<void> {
  try {
    applyAppSettings(await window.api.resetScanThreads());
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
  }
}

function openSettingsDialog(): void {
  settingsDialogOpen.value = true;
  void loadAppSettings();
}

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
  unsubscribeExecuteProgress?.();
  if (toastTimer) clearTimeout(toastTimer);
  if (execShowTimer) clearTimeout(execShowTimer);
  if (execHideTimer) clearTimeout(execHideTimer);
});

async function pick(side: "left" | "right"): Promise<void> {
  const current = side === "left" ? leftRoot.value : rightRoot.value;
  const picked = await window.api.pickDirectory(current ?? undefined);
  if (!picked) return;
  if (side === "left") leftRoot.value = picked;
  else rightRoot.value = picked;
}

/** 互换左右目录；已扫描时直接镜像结果，不重新扫描 */
function swapRoots(): void {
  if (!leftRoot.value || !rightRoot.value) return;
  swappingRoots = true;
  const left = leftRoot.value;
  leftRoot.value = rightRoot.value;
  rightRoot.value = left;
  if (result.value) {
    result.value = mirrorScanResult(result.value);
    previewSide.value = null;
    selected.value = new Set();
    showToast("已互换左右目录，结果同步翻转");
    return;
  }
  showToast("已互换左右目录");
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

/** 目录变化或开始扫描时作废旧结果；改条件不清空 */
function resetResult(): void {
  result.value = null;
  selected.value = new Set();
  previewSide.value = null;
}

const emptyText = computed(() => {
  if (!leftRoot.value || !rightRoot.value) return "先选择左右两个目录";
  if (!result.value) return "点击右上角的「重新扫描」设置条件并开始比较";
  return "两侧内容一致";
});

/** 修改日期窗口：三态互斥，按自然日计算 */
function timeWindow(): { modifiedAfter: number; modifiedBefore: number } {
  return resolveTimeWindow({
    mode: timeMode.value,
    recentDays: recentDays.value,
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
  });
}

/* 扫描过滤行：只列相对默认值被改过的项，顺序与显示过滤行一致；只在扫描成功后更新 */
const scanFilterTags = computed(() => {
  const filters = scannedFilters.value;
  const tags: string[] = [];
  if (filters.maxDepth > 0) tags.push(`层级 ≤ ${filters.maxDepth}`);
  if (filters.includeKeywordInput.trim()) {
    tags.push(`只含关键字 ${filters.includeKeywordInput.trim()}`);
  }
  if (filters.excludeKeywordInput.trim()) {
    tags.push(`排除关键字 ${filters.excludeKeywordInput.trim()}`);
  }
  if (filters.includeInput.trim()) tags.push(`只含后缀 ${filters.includeInput.trim()}`);
  if (filters.excludeInput.trim()) tags.push(`排除后缀 ${filters.excludeInput.trim()}`);
  if (filters.timeMode === "recent") {
    tags.push(`最近 ${filters.recentDays} 天`);
  } else if (filters.timeMode === "custom") {
    if (filters.dateFrom && filters.dateTo) tags.push(`${filters.dateFrom} 至 ${filters.dateTo}`);
    else if (filters.dateFrom) tags.push(`起始 ${filters.dateFrom}`);
    else if (filters.dateTo) tags.push(`截止 ${filters.dateTo}`);
  }
  if (filters.sizeEnabled && (filters.sizeMin > 0 || filters.sizeMax > 0)) {
    if (filters.sizeMin > 0 && filters.sizeMax > 0) {
      tags.push(
        `大小 ${filters.sizeMin} ${filters.sizeMinUnit}–${filters.sizeMax} ${filters.sizeMaxUnit}`,
      );
    } else if (filters.sizeMin > 0) {
      tags.push(`大小 ≥ ${filters.sizeMin} ${filters.sizeMinUnit}`);
    } else {
      tags.push(`大小 ≤ ${filters.sizeMax} ${filters.sizeMaxUnit}`);
    }
  }
  if (!filters.skipHidden) tags.push("不跳过隐藏文件");
  return tags;
});

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
  /* 校验通过：作废旧结果并落盘条件；取消后为空结果，成功后才更新摘要 */
  const attempted = currentFilters();
  resetResult();
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
      includeKeyword: includeKeywordInput.value.trim(),
      excludeKeyword: excludeKeywordInput.value.trim(),
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
    scannedFilters.value = attempted;
    upsertLocalPair(true);
    selected.value = new Set();
    alerts.value = scanned.warnings.map((message) => ({ message }));
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
  if (!message || alerts.value.some((item) => item.message === message)) return;
  alerts.value = [...alerts.value, { message }];
  void window.api.log("warn", `[ui] ${message}`);
}

/** 带「重试失败项」入口的告警（仅执行失败） */
function pushRetryAlert(message: string, actions: SyncAction[]): void {
  alerts.value = [
    ...alerts.value.filter((item) => item.message !== message),
    { message, retry: actions },
  ];
  void window.api.log("warn", `[ui] ${message}`);
}

function retryAlert(index: number): void {
  const item = alerts.value[index];
  if (!item?.retry?.length) return;
  alerts.value = alerts.value.filter((_, i) => i !== index);
  execVisible.value = false;
  void runActions(item.retry, "重试失败项");
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
      leftDate: side === "left" ? file.mtimeMs : null,
      rightDate: side === "right" ? file.mtimeMs : null,
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

function resetExecWindow(total: number): void {
  if (execShowTimer) clearTimeout(execShowTimer);
  if (execHideTimer) clearTimeout(execHideTimer);
  execShowTimer = null;
  execHideTimer = null;
  execVisible.value = false;
  execMinimized.value = false;
  execState.value = "running";
  execSummary.value = "";
  execProgress.value = {
    done: 0,
    total,
    currentPath: "",
    fileBytesDone: 0,
    fileBytesTotal: 0,
    bytesPerSecond: 0,
    etaSeconds: null,
  };
}

/** 300ms 内完成的小任务不弹进度窗，避免闪烁 */
function openExecWindowSoon(): void {
  execShowTimer = setTimeout(() => {
    execShowTimer = null;
    if (executing.value) execVisible.value = true;
  }, 300);
}

async function pauseExecute(): Promise<void> {
  if (execState.value !== "running") return;
  await window.api.pauseExecute();
  execState.value = "paused";
}

async function resumeExecute(): Promise<void> {
  if (execState.value !== "paused") return;
  await window.api.resumeExecute();
  execState.value = "running";
}

async function cancelExecute(): Promise<void> {
  await window.api.cancelExecute();
}

/** 重试失败项：只重跑本次 failed 的动作 */
function retryExecFailed(): void {
  if (execFailures.value.length === 0) return;
  const actions = execFailures.value;
  execVisible.value = false;
  void runActions(actions, "重试失败项");
}

/** 调整复制限速：执行中立即生效；下次执行随请求带走 */
async function changeExecRate(megabytesPerSecond: number): Promise<void> {
  execRateLimit.value = megabytesPerSecond;
  await window.api.setExecuteRate(megabytesPerSecond * 1024 * 1024);
}

async function runActions(actions: SyncAction[], label: string): Promise<void> {
  if (!leftRoot.value || !rightRoot.value) return;
  if (actions.length === 0) {
    showToast(`${label}：没有可执行的动作`);
    return;
  }
  if (executing.value) return;
  executing.value = true;
  execFailures.value = [];
  resetExecWindow(actions.length);
  openExecWindowSoon();
  try {
    const outcome = await window.api.execute({
      leftRoot: leftRoot.value,
      rightRoot: rightRoot.value,
      actions,
      rateLimitBytesPerSec: execRateLimit.value * 1024 * 1024,
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

    const failedPaths = new Set(outcome.failed.map((item) => item.path));
    execFailures.value = actions.filter((action) => failedPaths.has(action.toPath));

    execSummary.value = `复制 ${outcome.copied}，改名 ${outcome.moved}，删除 ${outcome.deleted}`;
    execState.value = outcome.cancelled ? "cancelled" : "done";
    execProgress.value = {
      ...(execProgress.value ?? {
        done: 0,
        total: actions.length,
        currentPath: "",
        fileBytesDone: 0,
        fileBytesTotal: 0,
        bytesPerSecond: 0,
        etaSeconds: null,
      }),
      done: outcome.cancelled ? (execProgress.value?.done ?? 0) : actions.length,
      fileBytesDone: 0,
      fileBytesTotal: 0,
      bytesPerSecond: 0,
      etaSeconds: null,
    };
    if (execShowTimer) {
      clearTimeout(execShowTimer);
      execShowTimer = null;
    }
    execVisible.value = true;
    execMinimized.value = false;
    if (execHideTimer) clearTimeout(execHideTimer);
    execHideTimer = setTimeout(
      () => {
        execVisible.value = false;
        execHideTimer = null;
      },
      outcome.cancelled ? 2500 : 1500,
    );

    showToast(
      outcome.cancelled ? `${label}已取消：${execSummary.value}` : `${label}：${execSummary.value}`,
    );
    void window.api.log(
      "info",
      `[${label}] copied=${outcome.copied} moved=${outcome.moved} deleted=${outcome.deleted} ` +
        `failed=${outcome.failed.length} stale=${outcome.stale.length} cancelled=${outcome.cancelled}`,
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
      const message = outcome.failed
        .slice(0, 5)
        .map((item) => `${item.path}：${item.message}`)
        .join("；");
      pushRetryAlert(message, execFailures.value);
    }
  } catch (error) {
    pushAlert(error instanceof Error ? error.message : String(error));
    if (execShowTimer) {
      clearTimeout(execShowTimer);
      execShowTimer = null;
    }
    execVisible.value = false;
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
        v-model:include-keyword-input="includeKeywordInput"
        v-model:exclude-keyword-input="excludeKeywordInput"
        v-model:time-mode="timeMode"
        v-model:date-from="dateFrom"
        v-model:date-to="dateTo"
        v-model:recent-days="recentDays"
        v-model:skip-hidden="skipHidden"
        v-model:scan-threads="scanThreads"
        v-model:scan-threads-auto="scanThreadsAuto"
        :pairs="pairEntries"
        :logical-processors="logicalProcessors"
        class="min-h-0 flex-1"
        @pick="pick"
        @pick-pair="pickPairRoots"
        @remove-pair="removePair"
        @scan-threads-change="saveScanThreads"
        @reset-scan-threads="resetScanThreads"
        @start="scan($event)"
        @close="settingsOpen = false"
      />

      <template v-else>
        <div class="relative">
          <ScanFilterLine :tags="scanFilterTags" @rescan="settingsOpen = true" />
          <FilterPanel
            v-model:keywordMode="displayKeywordMode"
            v-model:keywordInput="displayKeywordInput"
            v-model:suffixMode="displaySuffixMode"
            v-model:suffixInput="displaySuffixInput"
            v-model:dateFrom="displayDateFrom"
            v-model:dateTo="displayDateTo"
            v-model:sizeMin="displaySizeMin"
            v-model:sizeMax="displaySizeMax"
            v-model:sizeMinUnit="displaySizeMinUnit"
            v-model:sizeMaxUnit="displaySizeMaxUnit"
            v-model:depth="displayDepth"
            v-model:skipHidden="displaySkipHidden"
            @reset="resetDisplayFilter"
          />
          <ViewModeLine
            v-model:hideSame="hideSame"
            v-model:viewMode="viewMode"
            :view-locked="previewSide !== null"
          />
        </div>

        <main class="flex min-h-0 flex-1 flex-col">
          <div class="relative min-h-0 flex-1 overflow-auto">
            <div class="flex">
              <!-- 左列：目录表头 / 列头 / 行 -->
              <div class="flex min-w-0 flex-1 flex-col">
                <div
                  class="sticky top-0 z-20 flex h-9 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 text-xs"
                >
                  <span
                    class="min-w-0 flex-1 truncate font-medium"
                    :class="leftRoot ? 'text-slate-300' : 'text-slate-600'"
                    :title="leftRoot ?? ''"
                  >
                    {{ leftRoot || "未选择左侧目录" }}
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="!leftRoot"
                    title="在文件管理器中打开"
                    @click="openDir('left')"
                  >
                    打开
                  </button>
                </div>

                <div
                  class="sticky top-9 z-20 flex h-7 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 text-xs text-slate-500"
                >
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-1 pl-3.5 text-left hover:text-slate-300"
                    title="点击排序：升序 / 降序 / 默认"
                    @click="toggleSort('path')"
                  >
                    <span class="min-w-0 flex-1 truncate">路径</span>
                    <span class="w-3 shrink-0 text-center text-sky-400">{{
                      sortArrow("path")
                    }}</span>
                  </button>
                  <button
                    type="button"
                    class="w-20 shrink-0 text-right hover:text-slate-300"
                    title="点击排序：升序 / 降序 / 默认"
                    @click="toggleSort('date')"
                  >
                    修改日期
                    <span class="inline-block w-3 text-center text-sky-400">{{
                      sortArrow("date")
                    }}</span>
                  </button>
                  <button
                    type="button"
                    class="w-16 shrink-0 text-right hover:text-slate-300"
                    title="点击排序：升序 / 降序 / 默认"
                    @click="toggleSort('size')"
                  >
                    大小
                    <span class="inline-block w-3 text-center text-sky-400">{{
                      sortArrow("size")
                    }}</span>
                  </button>
                </div>

                <FileList
                  v-if="items.length > 0"
                  side="left"
                  :items="items"
                  @toggle="toggle"
                  @menu="onRowMenu"
                />
              </div>

              <!-- 中列：互换 / 全选 / 行操作 -->
              <div class="flex w-24 shrink-0 flex-col border-x border-slate-800 bg-slate-900/30">
                <div
                  class="sticky top-0 z-20 flex h-9 items-center justify-center border-b border-slate-800 bg-slate-950"
                >
                  <button
                    type="button"
                    class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="!leftRoot || !rightRoot"
                    title="左右目录互换"
                    @click="swapRoots"
                  >
                    ⇄
                  </button>
                </div>
                <div
                  class="sticky top-9 z-20 flex h-7 items-center justify-center border-b border-slate-800 bg-slate-900"
                >
                  <input
                    v-if="previewSide !== null"
                    type="checkbox"
                    class="h-3 w-3 accent-sky-500"
                    :checked="allSelected"
                    :indeterminate="someSelected"
                    :disabled="selectableIndexes.length === 0"
                    title="全选 / 取消全选"
                    @change="toggleAll"
                  />
                </div>
                <RowActions
                  v-if="items.length > 0"
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

              <!-- 右列：目录表头 / 列头 / 行 -->
              <div class="flex min-w-0 flex-1 flex-col">
                <div
                  class="sticky top-0 z-20 flex h-9 items-center gap-3 border-b border-slate-800 bg-slate-950 px-3 text-xs"
                >
                  <span
                    class="min-w-0 flex-1 truncate font-medium"
                    :class="rightRoot ? 'text-slate-300' : 'text-slate-600'"
                    :title="rightRoot ?? ''"
                  >
                    {{ rightRoot || "未选择右侧目录" }}
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded border border-slate-600 px-1.5 py-0.5 text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                    :disabled="!rightRoot"
                    title="在文件管理器中打开"
                    @click="openDir('right')"
                  >
                    打开
                  </button>
                </div>

                <div
                  class="sticky top-9 z-20 flex h-7 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 text-xs text-slate-500"
                >
                  <button
                    type="button"
                    class="flex min-w-0 flex-1 items-center gap-1 pl-3.5 text-left hover:text-slate-300"
                    title="点击排序：升序 / 降序 / 默认"
                    @click="toggleSort('path')"
                  >
                    <span class="min-w-0 flex-1 truncate">路径</span>
                    <span class="w-3 shrink-0 text-center text-sky-400">{{
                      sortArrow("path")
                    }}</span>
                  </button>
                  <button
                    type="button"
                    class="w-20 shrink-0 text-right hover:text-slate-300"
                    title="点击排序：升序 / 降序 / 默认"
                    @click="toggleSort('date')"
                  >
                    修改日期
                    <span class="inline-block w-3 text-center text-sky-400">{{
                      sortArrow("date")
                    }}</span>
                  </button>
                  <button
                    type="button"
                    class="w-16 shrink-0 text-right hover:text-slate-300"
                    title="点击排序：升序 / 降序 / 默认"
                    @click="toggleSort('size')"
                  >
                    大小
                    <span class="inline-block w-3 text-center text-sky-400">{{
                      sortArrow("size")
                    }}</span>
                  </button>
                </div>

                <FileList
                  v-if="items.length > 0"
                  side="right"
                  :items="items"
                  @toggle="toggle"
                  @menu="onRowMenu"
                />
              </div>
            </div>

            <div
              v-if="items.length === 0"
              class="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-xs text-slate-600"
            >
              {{ emptyText }}
            </div>
          </div>
        </main>

        <footer class="border-t border-slate-800 px-4 py-2">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-400">
            <div v-if="statItems.length > 0" class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span v-for="item in statItems" :key="item.key" class="flex items-center gap-1">
                <span class="h-1.5 w-1.5 rounded-full" :class="item.dot"></span>
                {{ item.label }} {{ item.count }}
              </span>
            </div>

            <div class="ml-auto flex flex-wrap items-center gap-2">
              <template v-if="previewSide !== null">
                <span class="flex flex-wrap items-center gap-3 text-slate-300">
                  <label
                    v-for="item in previewKindState"
                    :key="item.kind"
                    class="flex items-center gap-1"
                  >
                    <input
                      type="checkbox"
                      class="h-3.5 w-3.5 accent-sky-500 disabled:opacity-40"
                      :checked="item.total > 0 && item.picked === item.total"
                      :indeterminate="item.picked > 0 && item.picked < item.total"
                      :disabled="item.total === 0"
                      @change="togglePreviewKind(item.kind)"
                    />
                    <span>{{ item.label }} {{ item.count }}</span>
                  </label>
                  <span>忽略 {{ preview?.stats.ignored ?? 0 }}</span>
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
                    : 'border-slate-600 text-slate-300 hover:bg-slate-800'
                "
                :disabled="busy || !result"
                @click="togglePreview(option.value)"
              >
                {{ previewSide === option.value ? "退出预览" : option.label }}
              </button>

              <button
                type="button"
                class="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                @click="openRecycle"
              >
                回收站
              </button>

              <button
                type="button"
                title="设置"
                aria-label="设置"
                class="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                @click="openSettingsDialog"
              >
                设置
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
            class="flex items-start gap-3 px-4 py-1.5 text-xs text-amber-200"
          >
            <span class="flex-1">{{ alert.message }}</span>
            <button
              v-if="alert.retry"
              type="button"
              class="text-amber-300 underline hover:text-amber-100"
              @click="retryAlert(index)"
            >
              重试失败项
            </button>
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
      v-if="widerNotice"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60"
      @click.self="restoreDisplayNotice"
    >
      <ConfirmBubble
        floating
        title="显示条件超出扫描范围"
        :message="widerMessage"
        confirm-text="重新扫描"
        cancel-text="还原修改"
        @confirm="rescanFromNotice"
        @cancel="restoreDisplayNotice"
      />
    </div>

    <div
      v-if="rowMenu"
      class="fixed inset-0 z-40"
      @click="rowMenu = null"
      @contextmenu.prevent="rowMenu = null"
    ></div>
    <div
      v-if="rowMenu"
      class="fixed z-50 w-44 rounded border border-slate-600 bg-slate-900 py-1 text-xs shadow-xl"
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
    <AppSettingsDialog
      v-if="settingsDialogOpen"
      :scan-threads="scanThreads"
      :scan-threads-auto="scanThreadsAuto"
      :logical-processors="logicalProcessors"
      @close="settingsDialogOpen = false"
      @change-scan-threads="saveScanThreads"
      @reset-scan-threads="resetScanThreads"
    />
    <ExecuteProgressWindow
      :visible="execVisible"
      :minimized="execMinimized"
      :state="execState"
      :progress="execProgress"
      :summary="execSummary"
      :failed-count="execFailures.length"
      :rate-limit="execRateLimit"
      @pause="void pauseExecute()"
      @resume="void resumeExecute()"
      @cancel="void cancelExecute()"
      @close="execVisible = false"
      @minimize="execMinimized = true"
      @restore="execMinimized = false"
      @retry="retryExecFailed"
      @rate-change="void changeExecRate($event)"
    />
  </div>
</template>
