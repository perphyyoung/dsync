<script setup lang="ts">
import { computed, ref } from "vue";
import { etaHint, formatEta, formatSize } from "../lib/format";
import type { ScanProgress } from "../lib/types";
import ConfirmBubble from "./ConfirmBubble.vue";

const props = defineProps<{
  progress: ScanProgress | null;
  status: "running" | "paused" | "cancelled";
  forceRehash: boolean;
}>();

const emit = defineEmits<{
  pause: [];
  resume: [];
  cancel: [];
  back: [];
}>();

const PHASE_LABEL: Record<ScanProgress["phase"], string> = {
  scan: "扫描目录",
  hash: "计算哈希",
  pair: "配对",
  index: "写入索引",
};

const pauseConfirmOpen = ref(false);
const cancelConfirmOpen = ref(false);

const title = computed(() => {
  if (props.status === "paused") return "已暂停";
  if (props.forceRehash) return "强制重算";
  if (!props.progress) return "准备中";
  return PHASE_LABEL[props.progress.phase];
});

/** 哈希阶段若全部命中缓存，total 为 0，视为已完成 */
const percent = computed(() => {
  const current = props.progress;
  if (!current) return 0;
  if (current.phase === "hash" && current.total === 0) return 100;
  if (current.total <= 0) return 0;
  return Math.min(100, Math.round((current.done / current.total) * 100));
});

const countLabel = computed(() => {
  const current = props.progress;
  if (!current) return "";
  if (current.total > 0) {
    if (current.phase === "hash") {
      return `${formatSize(current.done)} / ${formatSize(current.total)}`;
    }
    return `${current.done} / ${current.total} 个文件`;
  }
  if (current.phase === "hash") return "全部命中缓存";
  if (current.discovered !== undefined) return `已发现 ${current.discovered} 个文件`;
  return "";
});

const etaLabel = computed(() => {
  if (props.status !== "running") return null;
  const current = props.progress;
  if (!current || current.phase !== "hash") return null;
  return formatEta(current.etaSeconds);
});

/** 耗时较长时给一条可执行建议；很短时不显示，避免噪声 */
const hint = computed(() => {
  if (props.status !== "running") return null;
  const current = props.progress;
  if (!current || current.phase !== "hash") return null;
  return etaHint(current.etaSeconds);
});

/** 收集路径阶段没有分母，进度条走不确定态 */
const indeterminate = computed(() => {
  const current = props.progress;
  return props.status === "running" && !!current && current.phase === "scan" && current.total === 0;
});

function confirmPause(): void {
  pauseConfirmOpen.value = false;
  emit("pause");
}

function confirmCancel(): void {
  cancelConfirmOpen.value = false;
  emit("cancel");
}
</script>

<template>
  <div
    class="flex h-full flex-col items-center justify-center gap-6 bg-slate-950 px-6 text-slate-200"
  >
    <template v-if="status === 'cancelled'">
      <p class="text-base text-slate-300">已取消</p>
      <button
        type="button"
        class="rounded border border-slate-600 px-4 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        @click="emit('back')"
      >
        返回
      </button>
    </template>

    <template v-else>
      <p class="text-sm" :class="status === 'paused' ? 'text-amber-300' : 'text-slate-200'">
        {{ title }}
      </p>

      <div class="w-80">
        <div class="h-1 w-full overflow-hidden rounded bg-slate-800">
          <div
            class="h-full bg-sky-500 transition-all duration-200"
            :class="indeterminate ? 'w-1/3 animate-pulse' : ''"
            :style="indeterminate ? undefined : { width: `${percent}%` }"
          ></div>
        </div>
        <div class="mt-2 flex justify-between text-xs text-slate-500">
          <span>{{ countLabel }}</span>
          <span v-if="!indeterminate">{{ percent }}%</span>
        </div>
        <p v-if="etaLabel" class="mt-1 text-center text-xs text-slate-500">{{ etaLabel }}</p>
        <p
          v-if="hint"
          class="mt-1 text-center text-xs"
          :class="hint.level === 'strong' ? 'text-amber-300' : 'text-slate-500'"
        >
          {{ hint.text }}
        </p>
      </div>

      <div class="flex gap-2">
        <div class="relative">
          <button
            v-if="status === 'running'"
            type="button"
            class="rounded border border-slate-600 px-4 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            @click="pauseConfirmOpen = true"
          >
            暂停
          </button>
          <button
            v-else
            type="button"
            class="rounded bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
            @click="emit('resume')"
          >
            继续
          </button>

          <ConfirmBubble
            v-if="pauseConfirmOpen"
            title="暂停计算"
            message="已完成的进度会保留，恢复后继续。"
            confirm-text="暂停计算"
            @confirm="confirmPause"
            @cancel="pauseConfirmOpen = false"
          />
        </div>

        <div class="relative">
          <button
            type="button"
            class="rounded border border-rose-800 px-4 py-1.5 text-xs text-rose-300 hover:bg-rose-950/60"
            @click="cancelConfirmOpen = true"
          >
            取消
          </button>

          <ConfirmBubble
            v-if="cancelConfirmOpen"
            title="取消计算"
            message="已完成的进度会全部丢弃，下次从头开始。"
            confirm-text="取消并丢弃进度"
            danger
            @confirm="confirmCancel"
            @cancel="cancelConfirmOpen = false"
          />
        </div>
      </div>
    </template>
  </div>
</template>
