<script setup lang="ts">
const minSizeKb = defineModel<number>("minSizeKb", { required: true });
const includeInput = defineModel<string>("includeInput", { required: true });
const excludeInput = defineModel<string>("excludeInput", { required: true });
const ignoreCache = defineModel<boolean>("ignoreCache", { required: true });
const hideSame = defineModel<boolean>("hideSame", { required: true });
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
      <input v-model="ignoreCache" type="checkbox" class="accent-sky-500" />
      <span>忽略哈希缓存</span>
    </label>

    <label class="flex cursor-pointer items-center gap-2 text-slate-400">
      <input v-model="hideSame" type="checkbox" class="accent-sky-500" />
      <span>隐藏一致项</span>
    </label>
  </div>
</template>
