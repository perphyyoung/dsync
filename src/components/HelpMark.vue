<script setup lang="ts">
import Tooltip from "./Tooltip.vue";

defineProps<{ text: string }>();
</script>

<template>
  <Tooltip :text="text">
    <span
      class="flex h-4 w-4 items-center justify-center rounded-full border border-slate-700 text-[10px] text-slate-500"
    >
      ?
    </span>
  </Tooltip>
</template>
