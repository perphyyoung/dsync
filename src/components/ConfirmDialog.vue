<script setup lang="ts">
defineProps<{
  title: string;
  lines: string[];
  confirmText: string;
  danger: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
    <div class="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-4 shadow-2xl">
      <h2 class="text-sm font-medium text-slate-100">{{ title }}</h2>
      <ul class="mt-3 max-h-64 space-y-1 overflow-auto text-xs leading-relaxed text-slate-300">
        <li v-for="(line, index) in lines" :key="index">{{ line }}</li>
      </ul>
      <div class="mt-5 flex justify-end gap-2 text-xs">
        <button
          type="button"
          class="rounded border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          type="button"
          class="rounded px-3 py-1.5 font-medium text-white"
          :class="danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'"
          @click="emit('confirm')"
        >
          {{ confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
