<script setup lang="ts">
import { nextTick, ref } from "vue";

defineProps<{ text: string }>();

const trigger = ref<HTMLElement | null>(null);
const bubble = ref<HTMLElement | null>(null);
const visible = ref(false);
const position = ref({ left: 0, top: 0 });

const GAP = 6;
const MARGIN = 8;

/** 打开时按可用空间定位：上方优先，不够翻到下方；水平限制在视口内 */
async function show(): Promise<void> {
  visible.value = true;
  await nextTick();
  const anchor = trigger.value?.getBoundingClientRect();
  const box = bubble.value?.getBoundingClientRect();
  if (!anchor || !box) return;
  const top = anchor.top >= box.height + GAP ? anchor.top - GAP - box.height : anchor.bottom + GAP;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - box.width / 2, MARGIN),
    window.innerWidth - box.width - MARGIN,
  );
  position.value = { left, top };
}

function hide(): void {
  visible.value = false;
}
</script>

<template>
  <span ref="trigger" class="group relative inline-flex" @mouseenter="show" @mouseleave="hide">
    <slot />
    <span
      v-show="visible"
      ref="bubble"
      class="pointer-events-none fixed z-50 whitespace-nowrap rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 opacity-0 shadow-lg transition-opacity"
      :class="{ 'opacity-100': visible }"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
    >
      {{ text }}
    </span>
  </span>
</template>
