<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { formatDuration, formatEta, formatSize } from "../lib/format";
import type { ExecuteProgress } from "../lib/types";
import ConfirmBubble from "./ConfirmBubble.vue";

type ExecState = "running" | "paused" | "cancelled" | "done";

const props = defineProps<{
  visible: boolean;
  minimized: boolean;
  state: ExecState;
  /** 执行已结束，正在刷新列表；此时不提供关闭 / 重试 */
  refreshing: boolean;
  progress: ExecuteProgress | null;
  /** 本次执行耗时（毫秒），完成态展示 */
  elapsedMs: number;
  /** 成功复制的字节总数，完成态计算平均速度 */
  copiedBytes: number;
  summary: string;
  /** 失败动作数：> 0 时完成态显示重试入口 */
  failedCount: number;
  /** 复制限速（MB/s），0 表示不限 */
  rateLimit: number;
}>();

const emit = defineEmits<{
  pause: [];
  resume: [];
  cancel: [];
  close: [];
  minimize: [];
  restore: [];
  retry: [];
  rateChange: [number];
}>();

/* 取消确认就地展示，避免再开一层弹窗 */
const cancelPending = ref(false);
watch(
  () => props.state,
  () => {
    cancelPending.value = false;
  },
);

const title = computed(() => {
  if (props.state === "paused") return "已暂停";
  if (props.state === "cancelled") return "已取消";
  if (props.state === "done") return "已完成";
  return "同步中";
});

const percent = computed(() => {
  const p = props.progress;
  if (!p || p.total <= 0) return 0;
  return Math.min(100, Math.round((p.done / p.total) * 100));
});

const bytePercent = computed(() => {
  const p = props.progress;
  if (!p || p.bytesTotal <= 0) return 0;
  return Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100));
});

/* 速度与 ETA 由主进程计算，这里只格式化显示 */
const speedText = computed(() => {
  const rate = props.progress?.bytesPerSecond ?? 0;
  return rate > 0 ? `${formatSpeed(rate)}/s` : "";
});

const etaText = computed(() => formatEta(props.progress?.etaSeconds ?? null) ?? "");

function formatSpeed(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return kb >= 1 ? `${Math.round(kb)} KB` : `${Math.round(bytes)} B`;
}
</script>

<template>
  <template v-if="visible">
    <!-- 最小化：右下角胶囊 -->
    <button
      v-if="minimized"
      type="button"
      class="fixed right-6 bottom-6 z-50 rounded-full border border-slate-600 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 shadow-xl transition-colors hover:bg-slate-800 active:bg-slate-700"
      title="展开同步进度"
      @click="emit('restore')"
    >
      {{ title }} {{ percent }}%
    </button>

    <div
      v-else
      class="fixed right-6 bottom-6 z-50 w-80 rounded-lg border border-slate-600 bg-slate-900/95 p-3 text-xs shadow-2xl backdrop-blur"
    >
      <div class="flex items-center justify-between">
        <span class="font-medium text-slate-100">{{ title }}</span>
        <button
          v-if="state === 'running' || state === 'paused'"
          type="button"
          class="rounded-md border border-slate-600 px-2 py-0.5 text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
          title="最小化"
          @click="emit('minimize')"
        >
          最小化
        </button>
      </div>

      <div class="mt-2 flex items-center justify-between text-slate-400">
        <span>第 {{ progress?.done ?? 0 }}/{{ progress?.total ?? 0 }} 个</span>
        <span>{{ percent }}%</span>
      </div>
      <div class="mt-1 h-1.5 overflow-hidden rounded bg-slate-800">
        <div
          class="h-full bg-sky-500 transition-[width] duration-500 ease-linear"
          :style="{ width: `${percent}%` }"
        />
      </div>

      <p
        v-if="progress && progress.activeFiles > 1 && (state === 'running' || state === 'paused')"
        class="mt-2 text-slate-300"
      >
        {{ progress.activeFiles }} 个文件并行
      </p>
      <p
        v-else-if="progress?.currentPath && (state === 'running' || state === 'paused')"
        class="mt-2 truncate text-slate-300"
        :title="progress.currentPath"
      >
        {{ progress.currentPath }}
      </p>
      <p
        v-if="
          progress && progress.verifyingFiles > 0 && (state === 'running' || state === 'paused')
        "
        class="mt-1 text-amber-300"
      >
        校验中{{ progress.verifyingFiles > 1 ? `（${progress.verifyingFiles} 个文件）` : "" }}
      </p>

      <template
        v-if="progress && progress.bytesTotal > 0 && (state === 'running' || state === 'paused')"
      >
        <div class="mt-1.5 flex items-center justify-between text-slate-400">
          <span>{{ formatSize(progress.bytesDone) }} / {{ formatSize(progress.bytesTotal) }}</span>
          <span>{{ bytePercent }}%</span>
        </div>
        <div class="mt-1 h-1 overflow-hidden rounded bg-slate-800">
          <div
            class="h-full bg-sky-400 transition-[width] duration-500 ease-linear"
            :style="{ width: `${bytePercent}%` }"
          />
        </div>
        <p v-if="speedText" class="mt-1 text-slate-400">
          {{ speedText }}
          <span v-if="etaText"> · {{ etaText }}</span>
        </p>
      </template>

      <p v-if="state === 'done' || state === 'cancelled'" class="mt-2 text-slate-400">
        {{ summary }}
      </p>
      <p v-if="state === 'done' && copiedBytes > 0 && elapsedMs > 0" class="mt-1 text-slate-400">
        用时 {{ formatDuration(elapsedMs) }} · 平均
        {{ formatSpeed(copiedBytes / (elapsedMs / 1000)) }}/s
      </p>
      <p v-if="refreshing" class="mt-1 text-slate-400">正在刷新列表…</p>

      <div
        v-if="state === 'running' || state === 'paused'"
        class="mt-2 flex items-center gap-2 text-slate-400"
      >
        <span>限速</span>
        <select
          :value="rateLimit"
          aria-label="复制限速"
          class="h-7 rounded-md border border-slate-600 bg-slate-900 px-1 text-slate-200 transition-colors"
          @change="emit('rateChange', Number(($event.target as HTMLSelectElement).value))"
        >
          <option :value="0">不限</option>
          <option :value="10">10 MB/s</option>
          <option :value="50">50 MB/s</option>
          <option :value="100">100 MB/s</option>
        </select>
      </div>

      <div class="mt-3 flex items-center justify-end gap-2">
        <button
          v-if="state === 'running'"
          type="button"
          class="rounded-md border border-slate-600 px-2 py-0.5 text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
          @click="emit('pause')"
        >
          暂停
        </button>
        <button
          v-else-if="state === 'paused'"
          type="button"
          class="rounded-md border border-slate-600 px-2 py-0.5 text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
          @click="emit('resume')"
        >
          继续
        </button>
        <button
          v-if="state === 'running' || state === 'paused'"
          type="button"
          class="rounded-md border border-rose-700 px-2 py-0.5 text-rose-300 transition-colors hover:bg-rose-950/60 active:bg-rose-950"
          @click="cancelPending = true"
        >
          取消
        </button>
        <button
          v-if="(state === 'done' || state === 'cancelled') && !refreshing"
          type="button"
          class="rounded-md border border-slate-600 px-2 py-0.5 text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
          @click="emit('close')"
        >
          关闭
        </button>
        <button
          v-if="(state === 'done' || state === 'cancelled') && failedCount > 0 && !refreshing"
          type="button"
          class="rounded-md bg-emerald-600 px-2 py-0.5 font-medium text-white transition-colors hover:bg-emerald-500 active:bg-emerald-700"
          @click="emit('retry')"
        >
          重试失败项（{{ failedCount }}）
        </button>
      </div>

      <div v-if="cancelPending" class="mt-2">
        <ConfirmBubble
          floating
          title="取消同步"
          message="已完成的动作会保留，当前文件会被丢弃。"
          confirm-text="取消同步"
          cancel-text="继续执行"
          danger
          @confirm="emit('cancel')"
          @cancel="cancelPending = false"
        />
      </div>
    </div>
  </template>
</template>
