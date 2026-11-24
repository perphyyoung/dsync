<script setup lang="ts">
defineProps<{
  title?: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  danger?: boolean;
  /** 为 true 时不自带定位，由外层容器摆在触发点附近 */
  floating?: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <div
    class="w-72 rounded-lg border border-slate-600 bg-slate-900 p-3 text-left shadow-2xl"
    :class="floating ? '' : 'absolute top-full right-0 z-40 mt-2'"
  >
    <p v-if="title" class="text-xs font-medium text-slate-100">{{ title }}</p>
    <p class="mt-1 text-xs leading-relaxed whitespace-pre-line text-slate-400">{{ message }}</p>
    <div class="mt-3 flex justify-end gap-2 text-xs">
      <button
        type="button"
        class="rounded-md border border-slate-600 px-3 py-1 text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
        @click="emit('cancel')"
      >
        {{ cancelText ?? "取消" }}
      </button>
      <button
        type="button"
        class="rounded-md px-3 py-1 font-medium text-white transition-colors"
        :class="
          danger
            ? 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700'
            : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700'
        "
        @click="emit('confirm')"
      >
        {{ confirmText }}
      </button>
    </div>
  </div>
</template>
