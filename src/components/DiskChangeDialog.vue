<script setup lang="ts">
import type { DiskKind } from "../lib/types";

defineProps<{
  scan: { left: DiskKind; right: DiskKind };
  now: { left: DiskKind; right: DiskKind };
}>();

const emit = defineEmits<{
  continue: [];
  cancel: [];
  rescan: [];
  mute: [];
}>();

function kindText(kind: DiskKind): string {
  return kind === "ssd" ? "固态" : "非固态";
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60">
    <div class="w-96 rounded-lg border border-slate-600 bg-slate-900 p-4 text-xs shadow-2xl">
      <p class="text-sm font-medium text-slate-100">磁盘类型已变化</p>
      <p class="mt-2 leading-relaxed text-slate-400">
        扫描时左侧 {{ kindText(scan.left) }}、右侧 {{ kindText(scan.right) }}；现在左侧
        {{ kindText(now.left) }}、右侧 {{ kindText(now.right) }}。
      </p>
      <p class="mt-1 text-slate-400">继续会按当前类型执行，可能影响并发。</p>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          class="rounded-md px-2 py-1 text-slate-400 transition-colors hover:text-slate-200"
          @click="emit('mute')"
        >
          重启前不再提醒
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-600 px-2 py-1 text-slate-300 transition-colors hover:bg-slate-800"
          @click="emit('rescan')"
        >
          重新扫描
        </button>
        <button
          type="button"
          class="rounded-md border border-slate-600 px-2 py-1 text-slate-300 transition-colors hover:bg-slate-800"
          @click="emit('cancel')"
        >
          取消
        </button>
        <button
          type="button"
          class="rounded-md bg-sky-600 px-2 py-1 text-white transition-colors hover:bg-sky-500"
          @click="emit('continue')"
        >
          继续
        </button>
      </div>
    </div>
  </div>
</template>
