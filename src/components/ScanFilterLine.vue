<script setup lang="ts">
const props = defineProps<{
  tags: string[];
  /** 扫描 / 执行期间禁止重新扫描 */
  busy?: boolean;
}>();

const emit = defineEmits<{
  rescan: [];
}>();
</script>

<template>
  <div class="flex items-center gap-3 border-b border-slate-800 px-4 py-1.5 text-xs">
    <span class="shrink-0 text-slate-400">扫描条件</span>
    <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-slate-400">
      <span v-if="props.tags.length === 0" class="text-slate-500">无过滤条件，全量显示</span>
      <template v-else>
        <span v-for="(tag, index) in props.tags" :key="tag" class="flex items-center gap-2">
          <span v-if="index > 0" class="text-slate-700">·</span>
          {{ tag }}
        </span>
      </template>
    </div>
    <button
      type="button"
      class="shrink-0 rounded-md border border-slate-600 px-3 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      :disabled="props.busy"
      title="打开扫描设置页重新扫描"
      @click="emit('rescan')"
    >
      重新扫描
    </button>
  </div>
</template>
