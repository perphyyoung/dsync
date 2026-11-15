<script setup lang="ts">
import { computed } from "vue";
import type { BatchStats, Side } from "../lib/types";

const props = defineProps<{
  stats: BatchStats;
  baseline: Side;
  reorder: boolean;
  busy: boolean;
}>();

const emit = defineEmits<{
  "update:baseline": [value: Side];
  "update:reorder": [value: boolean];
  execute: [];
  close: [];
}>();

const BASELINE_OPTIONS: { value: Side; label: string }[] = [
  { value: "left", label: "以左侧为准" },
  { value: "right", label: "以右侧为准" },
];

const targetLabel = computed(() => (props.baseline === "left" ? "右侧" : "左侧"));
</script>

<template>
  <div class="flex h-full flex-col bg-slate-950 text-slate-200">
    <header class="flex items-center justify-between border-b border-slate-800 px-4 py-3">
      <h1 class="text-sm font-medium text-slate-100">批量执行</h1>
      <button
        type="button"
        class="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        @click="emit('close')"
      >
        返回
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-6 py-8">
      <div class="mx-auto flex max-w-md flex-col gap-8">
        <section>
          <h2 class="mb-2 text-xs text-slate-500">以哪一侧为准</h2>
          <div class="flex gap-2">
            <button
              v-for="option in BASELINE_OPTIONS"
              :key="option.value"
              type="button"
              class="flex-1 rounded border px-3 py-2 text-xs"
              :class="
                baseline === option.value
                  ? 'border-sky-600 bg-sky-950/60 text-sky-200'
                  : 'border-slate-700 text-slate-400 hover:bg-slate-900'
              "
              @click="emit('update:baseline', option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </section>

        <label class="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            class="accent-sky-500"
            :checked="reorder"
            @change="emit('update:reorder', ($event.target as HTMLInputElement).checked)"
          />
          <span>同时按基准侧重排路径</span>
        </label>

        <section class="rounded border border-slate-800 bg-slate-900/40 p-5">
          <p class="text-xs text-slate-500">{{ targetLabel }}将发生的变化</p>
          <dl class="mt-4 grid grid-cols-3 gap-3 text-center">
            <div>
              <dt class="text-[11px] text-slate-500">新增</dt>
              <dd class="mt-1 text-xl text-emerald-400">{{ stats.added }}</dd>
            </div>
            <div>
              <dt class="text-[11px] text-slate-500">修改</dt>
              <dd class="mt-1 text-xl text-amber-400">{{ stats.modified }}</dd>
            </div>
            <div>
              <dt class="text-[11px] text-slate-500">删除</dt>
              <dd class="mt-1 text-xl text-rose-400">{{ stats.deleted }}</dd>
            </div>
          </dl>
        </section>

        <p v-if="stats.blocked > 0" class="text-xs text-rose-400">
          {{ stats.blocked }} 行的目标路径被其他文件占用，执行时会跳过
        </p>

        <button
          type="button"
          class="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy || stats.rows === 0"
          @click="emit('execute')"
        >
          {{ busy ? "执行中…" : `执行这 ${stats.rows} 项` }}
        </button>
      </div>
    </div>
  </div>
</template>
