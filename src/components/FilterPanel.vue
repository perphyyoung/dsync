<script setup lang="ts">
import type { SizeUnit, ViewMode } from "../lib/types";

/* 显示过滤：只作用于列表，不进入扫描条件，也不持久化 */
const keywordMode = defineModel<"include" | "exclude">("keywordMode", { required: true });
const keywordInput = defineModel<string>("keywordInput", { required: true });
const suffixMode = defineModel<"include" | "exclude">("suffixMode", { required: true });
const suffixInput = defineModel<string>("suffixInput", { required: true });
const dateFrom = defineModel<string>("dateFrom", { required: true });
const dateTo = defineModel<string>("dateTo", { required: true });
const sizeMin = defineModel<number>("sizeMin", { required: true });
const sizeMax = defineModel<number>("sizeMax", { required: true });
const sizeMinUnit = defineModel<SizeUnit>("sizeMinUnit", { required: true });
const sizeMaxUnit = defineModel<SizeUnit>("sizeMaxUnit", { required: true });
const depth = defineModel<number>("depth", { required: true });
const skipHidden = defineModel<boolean>("skipHidden", { required: true });
const hideSame = defineModel<boolean>("hideSame", { required: true });
const viewMode = defineModel<ViewMode>("viewMode", { required: true });

const UNITS: SizeUnit[] = ["KB", "MB", "GB"];

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
    <label class="flex items-center gap-2">
      <span class="text-slate-500">目录层级</span>
      <input
        v-model.number="depth"
        type="number"
        min="0"
        step="1"
        title="0 表示不限；1 只显示根目录文件"
        class="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
      />
      <span class="text-slate-500">层</span>
    </label>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <select
        v-model="keywordMode"
        aria-label="关键字模式"
        class="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-slate-200"
      >
        <option value="include">只含关键字</option>
        <option value="exclude">排除关键字</option>
      </select>
      <input
        v-model="keywordInput"
        type="text"
        :placeholder="keywordMode === 'include' ? '输入单个词来命中' : '输入单个词来排除'"
        title="目录与文件名同时作用，只支持单个词"
        class="w-40 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
      />
    </div>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <select
        v-model="suffixMode"
        aria-label="后缀模式"
        class="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-slate-200"
      >
        <option value="include">只含后缀</option>
        <option value="exclude">排除后缀</option>
      </select>
      <input
        v-model="suffixInput"
        type="text"
        placeholder="md, ts"
        title="多个后缀用逗号分隔"
        class="w-32 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
      />
    </div>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <span class="text-slate-500">修改日期范围</span>
      <input
        v-model="dateFrom"
        type="date"
        aria-label="显示起始日期"
        class="w-32 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-slate-200 [color-scheme:dark]"
      />
      <span class="text-slate-600">至</span>
      <input
        v-model="dateTo"
        type="date"
        aria-label="显示结束日期"
        class="w-32 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-slate-200 [color-scheme:dark]"
      />
    </div>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <span class="text-slate-500">文件大小范围</span>
      <input
        v-model.number="sizeMin"
        type="number"
        min="0"
        step="1"
        title="0 表示不限"
        class="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
      />
      <select
        v-model="sizeMinUnit"
        class="rounded border border-slate-600 bg-slate-900 px-1 py-1 text-slate-200"
      >
        <option v-for="unit in UNITS" :key="unit" :value="unit">{{ unit }}</option>
      </select>
      <span class="text-slate-600">至</span>
      <input
        v-model.number="sizeMax"
        type="number"
        min="0"
        step="1"
        title="0 表示不限"
        class="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200"
      />
      <select
        v-model="sizeMaxUnit"
        class="rounded border border-slate-600 bg-slate-900 px-1 py-1 text-slate-200"
      >
        <option v-for="unit in UNITS" :key="unit" :value="unit">{{ unit }}</option>
      </select>
    </div>

    <span class="text-slate-700">·</span>

    <label class="flex cursor-pointer items-center gap-2 text-slate-400">
      <input v-model="skipHidden" type="checkbox" class="accent-sky-500" />
      <span>跳过隐藏文件</span>
    </label>

    <span class="text-slate-700">·</span>

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
