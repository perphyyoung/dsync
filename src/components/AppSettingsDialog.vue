<script setup lang="ts">
import { ref, watch } from "vue";
import type { DiskMode } from "../lib/types";

const props = defineProps<{
  scanThreads: number;
  scanThreadsAuto: boolean;
  copyThreads: number;
  copyThreadsAuto: boolean;
  parallelFiles: number;
  parallelFilesAuto: boolean;
  diskMode: DiskMode;
  autoCloseExecWindow: boolean;
  logicalProcessors: number;
}>();

const emit = defineEmits<{
  close: [];
  changeScanThreads: [value: number];
  resetScanThreads: [];
  changeCopyThreads: [value: number];
  resetCopyThreads: [];
  changeParallelFiles: [value: number];
  resetParallelFiles: [];
  changeDiskMode: [value: DiskMode];
  changeAutoCloseExecWindow: [value: boolean];
}>();

const scanValue = ref(props.scanThreads);
const copyValue = ref(props.copyThreads);
const filesValue = ref(props.parallelFiles);
watch(
  () => props.scanThreads,
  (next) => {
    scanValue.value = next;
  },
);
watch(
  () => props.copyThreads,
  (next) => {
    copyValue.value = next;
  },
);
watch(
  () => props.parallelFiles,
  (next) => {
    filesValue.value = next;
  },
);

function commitScan(): void {
  const next = Math.round(Number(scanValue.value));
  if (Number.isFinite(next)) emit("changeScanThreads", next);
}

function commitCopy(): void {
  const next = Math.round(Number(copyValue.value));
  if (Number.isFinite(next)) emit("changeCopyThreads", next);
}

function commitFiles(): void {
  const next = Math.round(Number(filesValue.value));
  if (Number.isFinite(next)) emit("changeParallelFiles", next);
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
    <div class="w-96 rounded-lg border border-slate-600 bg-slate-900 p-4 text-sm shadow-2xl">
      <div class="flex items-center justify-between">
        <span class="font-medium text-slate-100">设置</span>
        <button
          type="button"
          class="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
          @click="emit('close')"
        >
          关闭
        </button>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3">
        <span class="text-slate-400">扫描线程数</span>
        <div class="flex items-center gap-2">
          <input
            v-model.number="scanValue"
            type="number"
            min="1"
            :max="logicalProcessors"
            aria-label="扫描线程数"
            class="w-24 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
            @change="commitScan"
          />
          <span class="text-xs text-slate-500">/ {{ logicalProcessors }}</span>
        </div>
      </div>
      <div class="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{{ scanThreadsAuto ? "默认：逻辑处理器的一半" : "已手动设置" }}</span>
        <button
          v-if="!scanThreadsAuto"
          type="button"
          class="text-sky-400 hover:text-sky-300"
          @click="emit('resetScanThreads')"
        >
          恢复默认
        </button>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3">
        <span class="text-slate-400">复制线程数</span>
        <div class="flex items-center gap-2">
          <input
            v-model.number="copyValue"
            type="number"
            min="1"
            :max="logicalProcessors"
            aria-label="复制线程数"
            class="w-24 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
            @change="commitCopy"
          />
          <span class="text-xs text-slate-500">/ {{ logicalProcessors }}</span>
        </div>
      </div>
      <div class="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{{ copyThreadsAuto ? "默认：逻辑处理器一半（至少 2）" : "已手动设置" }}</span>
        <button
          v-if="!copyThreadsAuto"
          type="button"
          class="text-sky-400 hover:text-sky-300"
          @click="emit('resetCopyThreads')"
        >
          恢复默认
        </button>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3">
        <span class="text-slate-400">并行文件数</span>
        <div class="flex items-center gap-2">
          <input
            v-model.number="filesValue"
            type="number"
            min="1"
            :max="logicalProcessors"
            aria-label="并行文件数"
            class="w-24 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
            @change="commitFiles"
          />
          <span class="text-xs text-slate-500">/ {{ logicalProcessors }}</span>
        </div>
      </div>
      <div class="mt-1 flex items-center justify-between text-xs text-slate-500">
        <span>{{ parallelFilesAuto ? "默认：逻辑处理器一半（至少 2）" : "已手动设置" }}</span>
        <button
          v-if="!parallelFilesAuto"
          type="button"
          class="text-sky-400 hover:text-sky-300"
          @click="emit('resetParallelFiles')"
        >
          恢复默认
        </button>
      </div>

      <div class="mt-4 flex items-center justify-between gap-3">
        <span class="text-slate-400">磁盘类型</span>
        <select
          :value="diskMode"
          aria-label="磁盘类型"
          class="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
          @change="changeDiskMode"
        >
          <option value="auto">自动</option>
          <option value="ssd">固态</option>
          <option value="hdd">机械</option>
          <option value="network">网络</option>
        </select>
      </div>
      <p class="mt-1 text-xs text-slate-500">
        机械盘单文件不并行；网络盘最多 4 个文件并行；自动检测失败按机械盘处理。修改后下次执行生效。
      </p>

      <label class="mt-4 flex items-center justify-between gap-3">
        <span class="text-slate-400">复制完成后，自动关闭进度窗</span>
        <input
          type="checkbox"
          :checked="autoCloseExecWindow"
          aria-label="复制完成后自动关闭进度窗"
          class="accent-sky-500"
          @change="emit('changeAutoCloseExecWindow', ($event.target as HTMLInputElement).checked)"
        />
      </label>
      <p v-if="!autoCloseExecWindow" class="mt-1 text-xs text-slate-500">
        完成后保留窗口，可查看复制总用时与平均速度。
      </p>

      <p class="mt-4 text-xs text-slate-500">扫描线程数修改后下次扫描生效；机械硬盘建议调低。</p>
    </div>
  </div>
</template>
