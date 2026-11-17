<script setup lang="ts">
import type { SizeUnit } from "../lib/types";
import Tooltip from "./Tooltip.vue";

const enabled = defineModel<boolean>("enabled", { required: true });
const min = defineModel<number>("min", { required: true });
const max = defineModel<number>("max", { required: true });
const minUnit = defineModel<SizeUnit>("minUnit", { required: true });
const maxUnit = defineModel<SizeUnit>("maxUnit", { required: true });

const UNITS: SizeUnit[] = ["KB", "MB", "GB"];

const inputClass =
  "w-20 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 disabled:cursor-not-allowed disabled:opacity-40";
const unitClass =
  "rounded border border-slate-700 bg-slate-900 px-1 py-1 text-slate-200 disabled:cursor-not-allowed disabled:opacity-40";
</script>

<template>
  <div class="flex items-center gap-2">
    <label class="flex cursor-pointer items-center gap-2 text-slate-400">
      <input v-model="enabled" type="checkbox" class="accent-sky-500" />
      <span>启用</span>
    </label>
    <input
      v-model.number="min"
      type="number"
      min="0"
      step="1"
      title="最小值"
      :disabled="!enabled"
      :class="inputClass"
    />
    <select v-model="minUnit" title="最小值单位" :disabled="!enabled" :class="unitClass">
      <option v-for="unit in UNITS" :key="unit" :value="unit">{{ unit }}</option>
    </select>
    <span class="text-slate-600">至</span>
    <input
      v-model.number="max"
      type="number"
      min="0"
      step="1"
      title="最大值"
      :disabled="!enabled"
      :class="inputClass"
    />
    <select v-model="maxUnit" title="最大值单位" :disabled="!enabled" :class="unitClass">
      <option v-for="unit in UNITS" :key="unit" :value="unit">{{ unit }}</option>
    </select>
    <Tooltip text="0 表示该侧不限">
      <span
        class="flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 text-[10px] text-slate-500"
      >
        ?
      </span>
    </Tooltip>
  </div>
</template>
