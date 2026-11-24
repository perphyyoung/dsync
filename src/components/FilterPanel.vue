<script setup lang="ts">
import type { SizeUnit } from "../lib/types";

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

const emit = defineEmits<{
  reset: [];
}>();

const UNITS: SizeUnit[] = ["KB", "MB", "GB"];
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-800 px-4 py-2 text-xs"
  >
    <label class="flex items-center gap-2">
      <span class="text-slate-400">目录层级</span>
      <input
        v-model.number="depth"
        type="number"
        min="0"
        step="1"
        title="0 表示不限；1 只显示根目录文件"
        class="h-7 w-20 rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-200"
      />
      <span class="text-slate-400">层</span>
    </label>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <select
        v-model="keywordMode"
        aria-label="关键字模式"
        class="h-7 rounded-md border border-slate-600 bg-slate-900 px-1 text-slate-200"
      >
        <option value="include">只含关键字</option>
        <option value="exclude">排除关键字</option>
      </select>
      <input
        v-model="keywordInput"
        type="text"
        :placeholder="keywordMode === 'include' ? '输入单个词来命中' : '输入单个词来排除'"
        title="目录与文件名同时作用，只支持单个词"
        class="h-7 w-40 rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-200 placeholder:text-slate-600"
      />
    </div>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <select
        v-model="suffixMode"
        aria-label="后缀模式"
        class="h-7 rounded-md border border-slate-600 bg-slate-900 px-1 text-slate-200"
      >
        <option value="include">只含后缀</option>
        <option value="exclude">排除后缀</option>
      </select>
      <input
        v-model="suffixInput"
        type="text"
        placeholder="md, ts"
        title="多个后缀用逗号分隔"
        class="h-7 w-32 rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-200 placeholder:text-slate-600"
      />
    </div>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <span class="text-slate-400">修改日期范围</span>
      <input
        v-model="dateFrom"
        type="date"
        aria-label="显示起始日期"
        class="h-7 w-32 rounded-md border border-slate-600 bg-slate-900 px-1 text-slate-200 scheme-dark"
      />
      <span class="text-slate-400">至</span>
      <input
        v-model="dateTo"
        type="date"
        aria-label="显示结束日期"
        class="h-7 w-32 rounded-md border border-slate-600 bg-slate-900 px-1 text-slate-200 scheme-dark"
      />
    </div>

    <span class="text-slate-700">·</span>

    <div class="flex items-center gap-2">
      <span class="text-slate-400">文件大小范围</span>
      <input
        v-model.number="sizeMin"
        type="number"
        min="0"
        step="1"
        title="0 表示不限"
        class="h-7 w-20 rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-200"
      />
      <select
        v-model="sizeMinUnit"
        class="h-7 rounded-md border border-slate-600 bg-slate-900 px-1 text-slate-200"
      >
        <option v-for="unit in UNITS" :key="unit" :value="unit">{{ unit }}</option>
      </select>
      <span class="text-slate-400">至</span>
      <input
        v-model.number="sizeMax"
        type="number"
        min="0"
        step="1"
        title="0 表示不限"
        class="h-7 w-20 rounded-md border border-slate-600 bg-slate-900 px-2 text-slate-200"
      />
      <select
        v-model="sizeMaxUnit"
        class="h-7 rounded-md border border-slate-600 bg-slate-900 px-1 text-slate-200"
      >
        <option v-for="unit in UNITS" :key="unit" :value="unit">{{ unit }}</option>
      </select>
    </div>

    <span class="text-slate-700">·</span>

    <label class="flex cursor-pointer items-center gap-2 text-slate-400">
      <input v-model="skipHidden" type="checkbox" class="accent-sky-500" />
      <span>跳过隐藏文件</span>
    </label>

    <button
      type="button"
      class="ml-auto rounded-md border border-slate-600 px-3 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
      title="恢复显示过滤行默认值"
      @click="emit('reset')"
    >
      重置
    </button>
  </div>
</template>
