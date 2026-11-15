<script setup lang="ts">
defineProps<{
  title?: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <div
    class="absolute top-full right-0 z-40 mt-2 w-72 rounded-lg border border-slate-700 bg-slate-900 p-3 text-left shadow-2xl"
  >
    <p v-if="title" class="text-xs font-medium text-slate-100">{{ title }}</p>
    <p class="mt-1 text-xs leading-relaxed whitespace-pre-line text-slate-400">{{ message }}</p>
    <div class="mt-3 flex justify-end gap-2 text-xs">
      <button
        type="button"
        class="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
        @click="emit('cancel')"
      >
        {{ cancelText ?? "取消" }}
      </button>
      <button
        type="button"
        class="rounded px-3 py-1 font-medium text-white"
        :class="danger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'"
        @click="emit('confirm')"
      >
        {{ confirmText }}
      </button>
    </div>
  </div>
</template>
