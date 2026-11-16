<script setup lang="ts">
import { ref } from "vue";
import type { ViewMode } from "../lib/types";
import ConfirmBubble from "./ConfirmBubble.vue";

const minSizeKb = defineModel<number>("minSizeKb", { required: true });
const includeInput = defineModel<string>("includeInput", { required: true });
const excludeInput = defineModel<string>("excludeInput", { required: true });
const hideSame = defineModel<boolean>("hideSame", { required: true });
const viewMode = defineModel<ViewMode>("viewMode", { required: true });

const VIEW_OPTIONS: { value: ViewMode; label: string; title: string }[] = [
  { value: "all", label: "全部", title: "显示所有差异行" },
  { value: "left", label: "左侧", title: "只看左侧有文件的行" },
  { value: "right", label: "右侧", title: "只看右侧有文件的行" },
  { value: "duplicate", label: "重复", title: "只看重复：单侧有多个内容相同的文件" },
  { value: "blocked", label: "占用", title: "只看目标占用：两侧同路径但内容不同" },
];

const props = defineProps<{
  scanning: boolean;
  busy: boolean;
  /** 预览模式锁定显示模式，避免隐藏已勾选的行 */
  viewLocked: boolean;
}>();

const emit = defineEmits<{
  scan: [];
  forceRehash: [];
}>();

const rehashConfirmOpen = ref(false);

function confirmForceRehash(): void {
  rehashConfirmOpen.value = false;
  emit("forceRehash");
}
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-800 px-4 py-2 text-xs"
  >
    <label class="flex items-center gap-2">
      <span class="text-slate-500">最小大小</span>
      <input
        v-model.number="minSizeKb"
        type="number"
        min="0"
        step="1"
        class="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
      />
      <span class="text-slate-500">KB</span>
    </label>

    <label class="flex items-center gap-2">
      <span class="text-slate-500">只含后缀</span>
      <input
        v-model="includeInput"
        type="text"
        placeholder="md, ts"
        class="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
      />
    </label>

    <label class="flex items-center gap-2">
      <span class="text-slate-500">排除后缀</span>
      <input
        v-model="excludeInput"
        type="text"
        placeholder="log, tmp"
        class="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
      />
    </label>

    <label class="flex cursor-pointer items-center gap-2 text-slate-400">
      <input v-model="hideSame" type="checkbox" class="accent-sky-500" />
      <span>隐藏一致项</span>
    </label>

    <div class="flex items-center gap-2">
      <span class="text-slate-500">显示模式</span>
      <div class="flex items-center rounded border border-slate-700 p-0.5">
        <button
          v-for="option in VIEW_OPTIONS"
          :key="option.value"
          type="button"
          class="rounded px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          :class="
            viewMode === option.value
              ? 'bg-slate-700 text-slate-100'
              : 'text-slate-400 hover:text-slate-200'
          "
          :title="option.title"
          :disabled="props.viewLocked"
          @click="viewMode = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="relative ml-auto flex items-center gap-2">
      <button
        type="button"
        class="rounded bg-sky-600 px-4 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="props.busy"
        @click="emit('scan')"
      >
        {{ props.scanning ? "扫描中…" : "扫描" }}
      </button>

      <button
        type="button"
        class="rounded border border-rose-800 px-3 py-1 text-xs text-rose-300 hover:bg-rose-950/60 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="props.busy"
        title="不使用哈希缓存，重新读取所有文件内容"
        @click="rehashConfirmOpen = true"
      >
        强制重算
      </button>

      <div
        v-if="rehashConfirmOpen"
        class="fixed inset-0 z-30"
        @click="rehashConfirmOpen = false"
      ></div>
      <ConfirmBubble
        v-if="rehashConfirmOpen"
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
