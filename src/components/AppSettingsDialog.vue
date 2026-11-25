<script setup lang="ts">
import { ref, watch } from "vue";
import type { DiskMode } from "../lib/types";
import HelpMark from "./HelpMark.vue";

const props = defineProps<{
  scanThreads: number;
  scanThreadsAuto: boolean;
  ssdCopyThreads: number;
  ssdCopyThreadsAuto: boolean;
  ssdParallelFiles: number;
  ssdParallelFilesAuto: boolean;
  diskMode: DiskMode;
  autoCloseExecWindow: boolean;
  logicalProcessors: number;
}>();

const emit = defineEmits<{
  close: [];
  changeScanThreads: [value: number];
  resetScanThreads: [];
  changeSsdCopyThreads: [value: number];
  resetSsdCopyThreads: [];
  changeSsdParallelFiles: [value: number];
  resetSsdParallelFiles: [];
  changeDiskMode: [value: DiskMode];
  changeAutoCloseExecWindow: [value: boolean];
}>();

const scanValue = ref(props.scanThreads);
const ssdCopyValue = ref(props.ssdCopyThreads);
const ssdFilesValue = ref(props.ssdParallelFiles);
watch(
  () => props.scanThreads,
  (next) => {
    scanValue.value = next;
  },
);
watch(
  () => props.ssdCopyThreads,
  (next) => {
    ssdCopyValue.value = next;
  },
);
watch(
  () => props.ssdParallelFiles,
  (next) => {
    ssdFilesValue.value = next;
  },
);

function commitScan(): void {
  const next = Math.round(Number(scanValue.value));
  if (Number.isFinite(next)) emit("changeScanThreads", next);
}

function commitCopy(): void {
  const next = Math.round(Number(ssdCopyValue.value));
  if (Number.isFinite(next)) emit("changeSsdCopyThreads", next);
}

function commitFiles(): void {
  const next = Math.round(Number(ssdFilesValue.value));
  if (Number.isFinite(next)) emit("changeSsdParallelFiles", next);
}

function changeDiskMode(event: Event): void {
  emit("changeDiskMode", (event.target as HTMLSelectElement).value as DiskMode);
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[85vh] w-120 flex-col rounded-lg border border-slate-600 bg-slate-900 text-sm shadow-2xl"
    >
      <header class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <h2 class="text-sm font-medium text-slate-100">设置</h2>
        <button
          type="button"
          class="rounded-md border border-slate-600 px-3 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
          @click="emit('close')"
        >
          关闭
        </button>
      </header>
      <div class="min-h-0 flex-1 overflow-auto px-4 py-2">
        <h3
          class="mb-1 mt-3 border-t border-slate-800 px-2 pt-3 text-xs font-medium text-slate-300 first:mt-1 first:border-0 first:pt-0"
        >
          扫描
        </h3>
        <div
          class="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 hover:bg-slate-800/40"
        >
          <span class="flex items-center gap-1.5 text-slate-400">
            扫描线程数
            <HelpMark text="默认取逻辑处理器的一半；修改后下次扫描生效，机械硬盘建议调低" />
          </span>
          <div class="flex items-center gap-2">
            <button
              v-if="!scanThreadsAuto"
              type="button"
              class="text-xs text-sky-400 transition-colors hover:text-sky-300"
              @click="emit('resetScanThreads')"
            >
              恢复默认
            </button>
            <input
              v-model.number="scanValue"
              type="number"
              min="1"
              :max="logicalProcessors"
              aria-label="扫描线程数"
              class="h-8 w-20 rounded-md border border-slate-600 bg-slate-950 px-2 text-right text-slate-200 transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
              @change="commitScan"
            />
            <span class="w-10 text-xs text-slate-400">/ {{ logicalProcessors }}</span>
          </div>
        </div>

        <h3
          class="mb-1 mt-3 border-t border-slate-800 px-2 pt-3 text-xs font-medium text-slate-300"
        >
          复制
        </h3>
        <div
          class="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 hover:bg-slate-800/40"
        >
          <span class="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-slate-400">
            SSD 复制线程数
            <HelpMark
              text="默认取逻辑处理器一半（至少 2）；仅两侧都是 SSD 且文件 ≥64MB 时生效；机械盘 / 未知按 1MB 顺序流"
            />
          </span>
          <div class="flex items-center gap-2">
            <button
              v-if="!ssdCopyThreadsAuto"
              type="button"
              class="text-xs text-sky-400 transition-colors hover:text-sky-300"
              @click="emit('resetSsdCopyThreads')"
            >
              恢复默认
            </button>
            <input
              v-model.number="ssdCopyValue"
              type="number"
              min="1"
              :max="logicalProcessors"
              aria-label="SSD 复制线程数"
              class="h-8 w-20 rounded-md border border-slate-600 bg-slate-950 px-2 text-right text-slate-200 transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
              @change="commitCopy"
            />
            <span class="w-10 text-xs text-slate-400">/ {{ logicalProcessors }}</span>
          </div>
        </div>

        <div
          class="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 hover:bg-slate-800/40"
        >
          <span class="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-slate-400">
            SSD 并行文件数
            <HelpMark
              text="默认取逻辑处理器一半（至少 2）；仅两侧都是 SSD 时生效；机械盘 / 未知按单文件串行"
            />
          </span>
          <div class="flex items-center gap-2">
            <button
              v-if="!ssdParallelFilesAuto"
              type="button"
              class="text-xs text-sky-400 transition-colors hover:text-sky-300"
              @click="emit('resetSsdParallelFiles')"
            >
              恢复默认
            </button>
            <input
              v-model.number="ssdFilesValue"
              type="number"
              min="1"
              :max="logicalProcessors"
              aria-label="SSD 并行文件数"
              class="h-8 w-20 rounded-md border border-slate-600 bg-slate-950 px-2 text-right text-slate-200 transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
              @change="commitFiles"
            />
            <span class="w-10 text-xs text-slate-400">/ {{ logicalProcessors }}</span>
          </div>
        </div>

        <div
          class="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 hover:bg-slate-800/40"
        >
          <span class="flex items-center gap-1.5 text-slate-400">
            磁盘类型
            <HelpMark text="机械盘单文件不并行；自动检测失败按机械盘处理；修改后下次执行生效" />
          </span>
          <select
            :value="diskMode"
            aria-label="磁盘类型"
            class="h-8 rounded-md border border-slate-600 bg-slate-950 px-2 text-slate-200 transition-colors hover:border-slate-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            @change="changeDiskMode"
          >
            <option value="auto">自动</option>
            <option value="ssd">固态</option>
            <option value="hdd">机械</option>
          </select>
        </div>

        <h3
          class="mb-1 mt-3 border-t border-slate-800 px-2 pt-3 text-xs font-medium text-slate-300"
        >
          执行
        </h3>
        <div
          class="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 hover:bg-slate-800/40"
        >
          <span class="flex items-center gap-1.5 text-slate-400">
            复制完成后，自动关闭进度窗
            <HelpMark text="取消勾选后保留窗口，可查看复制总用时与平均速度" />
          </span>
          <input
            type="checkbox"
            :checked="autoCloseExecWindow"
            aria-label="复制完成后自动关闭进度窗"
            class="accent-sky-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            @change="emit('changeAutoCloseExecWindow', ($event.target as HTMLInputElement).checked)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
