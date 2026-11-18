<script setup lang="ts">
import type { ViewMode } from "../lib/types";

const hideSame = defineModel<boolean>("hideSame", { required: true });
const viewMode = defineModel<ViewMode>("viewMode", { required: true });

const VIEW_OPTIONS: { value: ViewMode; label: string; title: string }[] = [
  { value: "all", label: "全部", title: "显示所有差异行" },
  { value: "left", label: "左侧", title: "只看左侧有文件的行" },
  { value: "right", label: "右侧", title: "只看右侧有文件的行" },
  { value: "duplicate", label: "重复", title: "只看重复：单侧有多个内容相同的文件" },
  { value: "blocked", label: "占用", title: "只看目标占用：两侧同路径但内容不同" },
  { value: "special", label: "特殊", title: "只看特殊项：符号链接、特殊文件、读取失败" },
];

const props = defineProps<{
  /** 预览模式锁定显示模式，避免隐藏已勾选的行 */
  viewLocked: boolean;
}>();
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800 px-4 py-2 text-xs"
  >
    <label class="flex cursor-pointer items-center gap-2 text-slate-400">
      <input v-model="hideSame" type="checkbox" class="accent-sky-500" />
      <span>隐藏一致项</span>
    </label>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <span class="text-slate-500">显示模式</span>
      <div class="flex items-center rounded border border-slate-600 p-0.5">
        <button
          v-for="option in VIEW_OPTIONS"
          :key="option.value"
          type="button"
          class="rounded px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40"
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
  </div>
</template>
