<script setup lang="ts">
import { formatDate, formatSize } from "../lib/format";
import type { DiffRow, RowStatus, Side } from "../lib/types";

const props = defineProps<{
  side: Side;
  items: { row: DiffRow; index: number }[];
}>();

const emit = defineEmits<{
  toggle: [index: number];
  menu: [side: Side, index: number, event: MouseEvent];
}>();

const STATUS_DOT: Record<RowStatus, string> = {
  same: "bg-slate-600",
  moved: "bg-sky-400",
  duplicate: "bg-fuchsia-400",
  "left-only": "bg-emerald-400",
  "right-only": "bg-emerald-400",
  ignored: "bg-slate-700",
  "target-blocked": "bg-rose-500",
};

const STATUS_TEXT: Record<RowStatus, string> = {
  same: "一致",
  moved: "仅路径不同",
  duplicate: "重复",
  "left-only": "仅左侧",
  "right-only": "仅右侧",
  ignored: "特殊",
  "target-blocked": "目标占用",
};

function pathOf(row: DiffRow): string | null {
  return props.side === "left" ? row.left : row.right;
}

function sizeOf(row: DiffRow): number | null {
  return props.side === "left" ? row.leftSize : row.rightSize;
}

function dateOf(row: DiffRow): number | null {
  return props.side === "left" ? row.leftDate : row.rightDate;
}
</script>

<template>
  <div>
    <button
      v-for="item in items"
      :key="item.index"
      type="button"
      class="flex h-8 w-full items-center gap-2 border-b border-slate-900 px-3 text-left text-xs hover:bg-slate-900/70"
      :class="[
        item.row.status === 'ignored' ? 'opacity-50' : '',
        item.row.status === 'duplicate' ? 'opacity-40' : '',
        item.row.status === 'target-blocked' ? 'bg-rose-950/30 opacity-60' : '',
      ]"
      :title="STATUS_TEXT[item.row.status]"
      @click="emit('toggle', item.index)"
      @contextmenu="emit('menu', side, item.index, $event)"
    >
      <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="STATUS_DOT[item.row.status]"></span>
      <span
        class="min-w-0 flex-1 truncate"
        :class="pathOf(item.row) ? 'text-slate-200' : 'text-slate-700'"
        :title="pathOf(item.row) ?? ''"
      >
        {{ pathOf(item.row) ?? "—" }}
      </span>
      <span class="w-20 shrink-0 text-right text-slate-400">{{
        formatDate(dateOf(item.row))
      }}</span>
      <span class="w-16 shrink-0 text-right text-slate-400">{{
        formatSize(sizeOf(item.row))
      }}</span>
    </button>
  </div>
</template>
