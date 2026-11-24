<script setup lang="ts">
import Tooltip from "./Tooltip.vue";

defineProps<{ text: string }>();
</script>

<template>
  <Tooltip :text="text">
    <span
      role="img"
      :aria-label="text"
      class="flex h-4 w-4 items-center justify-center rounded-full border border-slate-600 text-[0.625rem] text-slate-400"
    >
      ?
    </span>
  </Tooltip>
</template>
