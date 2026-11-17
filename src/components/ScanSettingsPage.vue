<script setup lang="ts">
import { ref } from "vue";
import type { Side } from "../lib/types";
import ConfirmBubble from "./ConfirmBubble.vue";

const leftRoot = defineModel<string>("leftRoot", { required: true });
const rightRoot = defineModel<string>("rightRoot", { required: true });
const minSizeKb = defineModel<number>("minSizeKb", { required: true });
const includeInput = defineModel<string>("includeInput", { required: true });
const excludeInput = defineModel<string>("excludeInput", { required: true });

const emit = defineEmits<{
  pick: [side: Side];
  start: [];
  forceRehash: [];
  close: [];
}>();

const rehashConfirmOpen = ref(false);

function confirmForceRehash(): void {
  rehashConfirmOpen.value = false;
  emit("forceRehash");
}
</script>

<template>
  <div class="flex h-full flex-col bg-slate-950 text-slate-200">
    <header class="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
      <span class="text-sm font-medium">扫描设置</span>
      <button
        type="button"
        class="ml-auto rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        @click="emit('close')"
      >
        返回
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-4 py-6">
      <div class="mx-auto flex w-full max-w-2xl flex-col gap-3 text-xs">
        <div class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-slate-500">左侧目录</span>
          <span
            class="min-w-0 flex-1 truncate rounded border border-slate-800 bg-slate-900 px-2 py-1.5"
            :class="leftRoot ? 'text-slate-200' : 'text-slate-600'"
            :title="leftRoot"
          >
            {{ leftRoot || "未选择左侧目录" }}
          </span>
          <button
            type="button"
            class="shrink-0 rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
            title="更改左侧目录"
            @click="emit('pick', 'left')"
          >
            更改
          </button>
        </div>

        <div class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-slate-500">右侧目录</span>
          <span
            class="min-w-0 flex-1 truncate rounded border border-slate-800 bg-slate-900 px-2 py-1.5"
            :class="rightRoot ? 'text-slate-200' : 'text-slate-600'"
            :title="rightRoot"
          >
            {{ rightRoot || "未选择右侧目录" }}
          </span>
          <button
            type="button"
            class="shrink-0 rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
            title="更改右侧目录"
            @click="emit('pick', 'right')"
          >
            更改
          </button>
        </div>

        <label class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-slate-500">最小大小</span>
          <input
            v-model.number="minSizeKb"
            type="number"
            min="0"
            step="1"
            class="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          />
          <span class="text-slate-500">KB</span>
        </label>

        <label class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-slate-500">只含后缀</span>
          <input
            v-model="includeInput"
            type="text"
            placeholder="md, ts"
            class="w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
          />
        </label>

        <label class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-slate-500">排除后缀</span>
          <input
            v-model="excludeInput"
            type="text"
            placeholder="log, tmp"
            class="w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
          />
        </label>
      </div>
    </div>

    <footer
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500"
    >
      <span>扫描只读，不会修改任何文件</span>
      <div class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="rounded border border-rose-800 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/60"
          title="不使用哈希缓存，重新读取所有文件内容"
          @click="rehashConfirmOpen = true"
        >
          强制重算
        </button>
        <button
          type="button"
          class="rounded bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          @click="emit('start')"
        >
          开始扫描
        </button>
      </div>
    </footer>

    <div
      v-if="rehashConfirmOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60"
      @click.self="rehashConfirmOpen = false"
    >
      <ConfirmBubble
        floating
        title="强制重算"
        message="重新读取全部文件内容，耗时可能很长。&#10;不会修改任何文件，但之前因缓存被跳过的改动会重新出现。"
        confirm-text="开始重算"
        danger
        @confirm="confirmForceRehash"
        @cancel="rehashConfirmOpen = false"
      />
    </div>
  </div>
</template>
