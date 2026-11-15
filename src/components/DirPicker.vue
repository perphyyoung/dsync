<script setup lang="ts">
const props = defineProps<{
  label: string;
  path: string;
}>();

const emit = defineEmits<{ pick: [] }>();
</script>

<template>
  <button
    type="button"
    class="min-w-0 flex-1 truncate rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-left text-xs text-slate-200 hover:border-sky-600 hover:bg-slate-800"
    :title="path || `选择${props.label}`"
    @click="emit('pick')"
  >
    {{ path || `选择${props.label}` }}
  </button>
</template>
