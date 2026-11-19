<script setup lang="ts">
import { ref, watch } from "vue";

const props = defineProps<{
  scanThreads: number;
  scanThreadsAuto: boolean;
  logicalProcessors: number;
}>();

const emit = defineEmits<{
  close: [];
  changeScanThreads: [value: number];
  resetScanThreads: [];
}>();

const value = ref(props.scanThreads);
watch(
  () => props.scanThreads,
  (next) => {
    value.value = next;
  },
);

function commit(): void {
  const next = Math.round(Number(value.value));
  if (Number.isFinite(next)) emit("changeScanThreads", next);
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
            v-model.number="value"
            type="number"
            min="1"
            :max="logicalProcessors"
            aria-label="扫描线程数"
            class="w-24 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
            @change="commit"
          />
          <span class="text-xs text-slate-500">/ {{ logicalProcessors }}</span>
        </div>
      </div>

      <div class="mt-2 flex items-center justify-between text-xs text-slate-500">
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

      <p class="mt-3 text-xs text-slate-500">修改后下次扫描生效；机械硬盘建议调低。</p>
    </div>
  </div>
</template>
