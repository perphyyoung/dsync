<script setup lang="ts">
import { computed, ref } from "vue";
import { describeAction } from "../lib/format";
import type { RowDirection } from "../lib/row-actions";
import { rowDirections } from "../lib/row-actions";
import type { DiffRow, Side } from "../lib/types";
import ConfirmBubble from "./ConfirmBubble.vue";

const props = defineProps<{
  items: { row: DiffRow; index: number }[];
  selected: Set<number>;
  busy: boolean;
  /** 预览模式：只亮这一侧，另一侧置灰 */
  highlight?: Side | null;
  /** 预览模式才显示勾选框 */
  showCheckbox?: boolean;
}>();

const emit = defineEmits<{
  runLeft: [index: number];
  runRight: [index: number];
  toggle: [index: number];
}>();

const rows = computed(() =>
  props.items.map((item) => ({ index: item.index, dirs: rowDirections(item.row, item.index) })),
);

interface ConfirmState {
  index: number;
  side: "left" | "right";
  top: number;
  left: number;
  message: string;
}

const confirmState = ref<ConfirmState | null>(null);

function arrowClass(direction: RowDirection): string {
  if (direction.actions.length === 0) return "text-slate-800";
  return direction.deletes
    ? "text-rose-400 hover:bg-rose-950/70"
    : "text-sky-400 hover:bg-sky-950/70";
}

function arrowTitle(direction: RowDirection, side: "left" | "right"): string {
  if (direction.actions.length === 0) return "无内容可同步";
  if (direction.deletes) {
    return side === "left" ? "软删除左侧文件到回收站" : "软删除右侧文件到回收站";
  }
  return side === "left" ? "以右侧为准同步到左侧" : "以左侧为准同步到右侧";
}

/** 预览模式下，非目标方向淡出 */
function dimmed(side: "left" | "right"): string {
  return props.highlight && props.highlight !== side ? "opacity-20" : "";
}

/** defineEmits 的重载不接受联合事件名，拆成两个字面量分支 */
function emitRun(side: "left" | "right", index: number): void {
  if (side === "left") emit("runLeft", index);
  else emit("runRight", index);
}

/** 不涉及删除的方向直接执行；涉及删除时在点击位置弹出气泡确认 */
function onArrow(event: MouseEvent, index: number, side: "left" | "right"): void {
  const entry = rows.value.find((item) => item.index === index);
  if (!entry) return;
  const direction = side === "left" ? entry.dirs.left : entry.dirs.right;
  if (direction.actions.length === 0) return;

  if (!direction.deletes) {
    emitRun(side, index);
    return;
  }

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  confirmState.value = {
    index,
    side,
    top: rect.bottom + 6,
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
    message: direction.actions.map(describeAction).join("\n"),
  };
}

function confirmRun(): void {
  const state = confirmState.value;
  confirmState.value = null;
  if (!state) return;
  emitRun(state.side, state.index);
}
</script>

<template>
  <div>
    <div
      v-for="entry in rows"
      :key="entry.index"
      class="flex h-8 items-center justify-center gap-2 border-b border-slate-900"
    >
      <button
        type="button"
        class="flex h-5 w-5 items-center justify-center rounded text-[11px] leading-none disabled:cursor-not-allowed"
        :class="[arrowClass(entry.dirs.left), dimmed('left')]"
        :disabled="busy || entry.dirs.left.actions.length === 0"
        :title="arrowTitle(entry.dirs.left, 'left')"
        @click="onArrow($event, entry.index, 'left')"
      >
        &lt;
      </button>

      <span class="flex w-4 shrink-0 items-center justify-center">
        <input
          v-if="props.showCheckbox"
          type="checkbox"
          class="h-3 w-3 accent-sky-500"
          :checked="selected.has(entry.index)"
          @change="emit('toggle', entry.index)"
        />
      </span>

      <button
        type="button"
        class="flex h-5 w-5 items-center justify-center rounded text-[11px] leading-none disabled:cursor-not-allowed"
        :class="[arrowClass(entry.dirs.right), dimmed('right')]"
        :disabled="busy || entry.dirs.right.actions.length === 0"
        :title="arrowTitle(entry.dirs.right, 'right')"
        @click="onArrow($event, entry.index, 'right')"
      >
        &gt;
      </button>
    </div>

    <div v-if="confirmState" class="fixed inset-0 z-40" @click="confirmState = null"></div>
    <div
      v-if="confirmState"
      class="fixed z-50"
      :style="{ top: `${confirmState.top}px`, left: `${confirmState.left}px` }"
    >
      <ConfirmBubble
        floating
        title="确认删除"
        :message="confirmState.message"
        confirm-text="删除到回收站"
        danger
        @confirm="confirmRun"
        @cancel="confirmState = null"
      />
    </div>
  </div>
</template>
