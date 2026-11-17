<script setup lang="ts">
import { formatSize } from "../lib/format";
import type { DeletedRecord } from "../lib/types";

const props = defineProps<{
  items: DeletedRecord[];
  busy: boolean;
}>();

const emit = defineEmits<{
  restore: [item: DeletedRecord];
  close: [];
}>();
</script>

<template>
  <div class="flex h-full flex-col bg-slate-950 text-slate-200">
    <header class="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
      <span class="text-sm font-medium">回收站</span>
      <span class="text-xs text-slate-500">共 {{ props.items.length }} 项</span>
      <button
        type="button"
        class="ml-auto rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        @click="emit('close')"
      >
        返回
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-auto px-4 py-2">
      <p v-if="props.items.length === 0" class="px-3 py-12 text-center text-xs text-slate-600">
        回收站为空
      </p>
      <div v-else class="divide-y divide-slate-800">
        <div
          v-for="item in props.items"
          :key="`${item.side}-${item.id}`"
          class="flex items-center gap-3 py-2 text-xs"
        >
          <span class="w-10 shrink-0 text-slate-500">{{
            item.side === "left" ? "左侧" : "右侧"
          }}</span>
          <span class="min-w-0 flex-1 truncate" :title="item.path">{{ item.path }}</span>
          <span class="shrink-0 text-slate-500">{{ formatSize(item.size) }}</span>
          <button
            type="button"
            class="shrink-0 rounded border border-slate-600 px-2 py-0.5 text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="props.busy"
            @click="emit('restore', item)"
          >
            还原
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
