<script setup lang="ts">
defineProps<{ message: string }>();
</script>

<template>
  <div class="pointer-events-none fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
    <div class="rounded-md bg-slate-800 px-4 py-2 text-xs text-slate-200 shadow-lg">
      {{ message }}
    </div>
  </div>
</template>
