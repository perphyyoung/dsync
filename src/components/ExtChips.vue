<script setup lang="ts">
import { computed } from "vue";
import { parseExtInput } from "../lib/exts";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

/* 常见类型一键勾选：整组都在则整组移除，否则整组加入 */
const PRESETS: { label: string; exts: string[] }[] = [
  { label: "图片", exts: [".jpg", ".png", ".gif", ".webp", ".svg"] },
  { label: "文档", exts: [".md", ".txt", ".pdf", ".docx"] },
  { label: "代码", exts: [".ts", ".js", ".vue", ".py", ".rs"] },
];

const current = computed(() => new Set(parseExtInput(props.modelValue)));

function isActive(group: { exts: string[] }): boolean {
  return group.exts.every((ext) => current.value.has(ext));
}

function toggleGroup(group: { label: string; exts: string[] }): void {
  const next = new Set(current.value);
  const allIn = isActive(group);
  for (const ext of group.exts) {
    if (allIn) next.delete(ext);
    else next.add(ext);
  }
  emit("update:modelValue", [...next].join(", "));
}
</script>

<template>
  <div class="flex items-center gap-1">
    <span class="text-slate-600">快捷</span>
    <button
      v-for="group in PRESETS"
      :key="group.label"
      type="button"
      class="rounded border px-1.5 py-0.5 text-[11px] transition-colors"
      :class="
        isActive(group)
          ? 'border-sky-600 bg-sky-600/20 text-sky-300'
          : 'border-slate-700 text-slate-500 hover:text-slate-300'
      "
      :title="group.exts.join(' ')"
      @click="toggleGroup(group)"
    >
      {{ group.label }}
    </button>
  </div>
</template>
