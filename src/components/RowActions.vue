<script setup lang="ts">
import { computed } from "vue";
import type { RowDirection } from "../lib/row-actions";
import { rowDirections } from "../lib/row-actions";
import type { DiffRow } from "../lib/types";

const props = defineProps<{
  items: { row: DiffRow; index: number }[];
  selected: Set<number>;
  busy: boolean;
}>();

const emit = defineEmits<{
  runLeft: [index: number];
  runRight: [index: number];
  toggle: [index: number];
}>();

const rows = computed(() =>
  props.items.map((item) => ({ index: item.index, dirs: rowDirections(item.row, item.index) })),
);

function arrowClass(direction: RowDirection): string {
  if (direction.actions.length === 0) return "text-slate-800";
  return direction.deletes
    ? "text-rose-400 hover:bg-rose-950/70"
    : "text-sky-400 hover:bg-sky-950/70";
}

function arrowTitle(direction: RowDirection, side: "left" | "right"): string {
  if (direction.actions.length === 0) return "无内容可同步";
  if (direction.deletes) {
    return side === "left" ? "删除左侧文件到回收站" : "删除右侧文件到回收站";
  }
  return side === "left" ? "以右侧为准同步到左侧" : "以左侧为准同步到右侧";
}
</script>

<template>
  <div>
    <div
      v-for="entry in rows"
      :key="entry.index"
      class="flex h-8 items-center justify-center gap-1 border-b border-slate-900"
    >
      <button
        type="button"
        class="flex h-5 w-5 items-center justify-center rounded text-[11px] leading-none disabled:cursor-not-allowed"
        :class="arrowClass(entry.dirs.left)"
        :disabled="busy || entry.dirs.left.actions.length === 0"
        :title="arrowTitle(entry.dirs.left, 'left')"
        @click="emit('runLeft', entry.index)"
      >
        &lt;
      </button>

      <input
        type="checkbox"
        class="h-3 w-3 accent-sky-500"
        :checked="selected.has(entry.index)"
        @change="emit('toggle', entry.index)"
      />

      <button
        type="button"
        class="flex h-5 w-5 items-center justify-center rounded text-[11px] leading-none disabled:cursor-not-allowed"
        :class="arrowClass(entry.dirs.right)"
        :disabled="busy || entry.dirs.right.actions.length === 0"
        :title="arrowTitle(entry.dirs.right, 'right')"
        @click="emit('runRight', entry.index)"
      >
        &gt;
      </button>
    </div>
  </div>
</template>
