<script setup lang="ts">
import type { SizeUnit, TimeMode, ViewMode } from "../lib/types";
import SizeFilter from "./SizeFilter.vue";

const sizeEnabled = defineModel<boolean>("sizeEnabled", { required: true });
const sizeMin = defineModel<number>("sizeMin", { required: true });
const sizeMax = defineModel<number>("sizeMax", { required: true });
const sizeMinUnit = defineModel<SizeUnit>("sizeMinUnit", { required: true });
const sizeMaxUnit = defineModel<SizeUnit>("sizeMaxUnit", { required: true });
const maxDepth = defineModel<number>("maxDepth", { required: true });
const includeInput = defineModel<string>("includeInput", { required: true });
const excludeInput = defineModel<string>("excludeInput", { required: true });
const excludePathsInput = defineModel<string>("excludePathsInput", { required: true });
const timeMode = defineModel<TimeMode>("timeMode", { required: true });
const dateFrom = defineModel<string>("dateFrom", { required: true });
const dateTo = defineModel<string>("dateTo", { required: true });
const recentDays = defineModel<number>("recentDays", { required: true });
const skipHidden = defineModel<boolean>("skipHidden", { required: true });
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
  busy: boolean;
  /** 预览模式锁定显示模式，避免隐藏已勾选的行 */
  viewLocked: boolean;
}>();

const emit = defineEmits<{
  openSettings: [];
}>();
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-slate-800 px-4 py-2 text-xs"
  >
    <div class="flex items-center gap-2">
      <span class="text-slate-500">文件大小</span>
      <SizeFilter
        v-model:enabled="sizeEnabled"
        v-model:min="sizeMin"
        v-model:max="sizeMax"
        v-model:minUnit="sizeMinUnit"
        v-model:maxUnit="sizeMaxUnit"
      />
    </div>

    <label class="flex items-center gap-2">
      <span class="text-slate-500">目录层级</span>
      <input
        v-model.number="maxDepth"
        type="number"
        min="0"
        step="1"
        title="0 不限，1 只扫根目录"
        class="w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
      />
      <span class="text-slate-500">层</span>
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

    <label class="flex items-center gap-2">
      <span class="text-slate-500">排除路径</span>
      <input
        v-model="excludePathsInput"
        type="text"
        placeholder="node_modules, dist"
        class="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
      />
    </label>

    <div class="flex items-center gap-2">
      <span class="text-slate-500">修改时间范围</span>
      <select
        v-model="timeMode"
        aria-label="修改时间范围"
        class="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200"
      >
        <option value="none">不限</option>
        <option value="recent">最近</option>
        <option value="custom">自定义</option>
      </select>
      <template v-if="timeMode === 'recent'">
        <input
          v-model.number="recentDays"
          type="number"
          min="1"
          step="1"
          aria-label="最近天数"
          class="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
        />
        <span class="text-slate-500">天</span>
      </template>
      <template v-else-if="timeMode === 'custom'">
        <input
          v-model="dateFrom"
          type="date"
          aria-label="开始日期"
          class="w-32 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200 [color-scheme:dark]"
        />
        <span class="text-slate-600">至</span>
        <input
          v-model="dateTo"
          type="date"
          aria-label="结束日期"
          class="w-32 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-slate-200 [color-scheme:dark]"
        />
      </template>
    </div>

    <label class="flex cursor-pointer items-center gap-2 text-slate-400">
      <input v-model="skipHidden" type="checkbox" class="accent-sky-500" />
      <span>跳过隐藏文件</span>
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

    <div class="ml-auto flex items-center gap-2">
      <button
        type="button"
        class="rounded bg-sky-600 px-4 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="props.busy"
        title="打开扫描设置"
        @click="emit('openSettings')"
      >
        扫描
      </button>
    </div>
  </div>
</template>
