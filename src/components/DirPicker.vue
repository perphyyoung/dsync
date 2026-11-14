<script setup lang="ts">
defineProps<{
  label: string;
  path: string;
}>();

const emit = defineEmits<{ pick: [] }>();
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col gap-1">
    <span class="text-[11px] tracking-wide text-slate-500 uppercase">{{ label }}</span>
    <button
      type="button"
      class="truncate rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-left text-xs text-slate-200 hover:border-sky-600 hover:bg-slate-800"
      :title="path || '点击选择目录'"
      @click="emit('pick')"
    >
      {{ path || "点击选择目录" }}
    </button>
  </div>
</template>
