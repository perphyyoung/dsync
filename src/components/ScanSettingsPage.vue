<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { pairKey, type DirPairEntry } from "../lib/dir-pairs";
import type { Side, SizeUnit, TimeMode } from "../lib/types";
import ConfirmBubble from "./ConfirmBubble.vue";
import ExtChips from "./ExtChips.vue";
import HelpMark from "./HelpMark.vue";
import SizeFilter from "./SizeFilter.vue";

const leftRoot = defineModel<string>("leftRoot", { required: true });
const rightRoot = defineModel<string>("rightRoot", { required: true });
const sizeEnabled = defineModel<boolean>("sizeEnabled", { required: true });
const sizeMin = defineModel<number>("sizeMin", { required: true });
const sizeMax = defineModel<number>("sizeMax", { required: true });
const sizeMinUnit = defineModel<SizeUnit>("sizeMinUnit", { required: true });
const sizeMaxUnit = defineModel<SizeUnit>("sizeMaxUnit", { required: true });
const maxDepth = defineModel<number>("maxDepth", { required: true });
const includeInput = defineModel<string>("includeInput", { required: true });
const excludeInput = defineModel<string>("excludeInput", { required: true });
const excludePathsInput = defineModel<string>("excludePathsInput", { required: true });
const timeMode = defineModel<TimeMode>("timeMode", { required: true });
const dateFrom = defineModel<string>("dateFrom", { required: true });
const dateTo = defineModel<string>("dateTo", { required: true });
const recentDays = defineModel<number>("recentDays", { required: true });
const skipHidden = defineModel<boolean>("skipHidden", { required: true });

const props = defineProps<{ pairs: DirPairEntry[] }>();

const emit = defineEmits<{
  pick: [side: Side];
  pickPair: [pair: DirPairEntry];
  removePair: [pair: DirPairEntry];
  start: [forceRehash: boolean];
  close: [];
}>();

const forceRehash = ref(false);
const rehashConfirmOpen = ref(false);

/* 勾选时先弹确认；取消勾选直接生效 */
watch(forceRehash, (value) => {
  if (value) rehashConfirmOpen.value = true;
});

function confirmForceRehash(): void {
  rehashConfirmOpen.value = false;
}

function cancelForceRehash(): void {
  forceRehash.value = false;
  rehashConfirmOpen.value = false;
}
const search = ref("");
const searchInput = ref<HTMLInputElement | null>(null);

/** 无关键词显示最近 10 组；输入后搜索全部档案（100 组） */
const filteredPairs = computed(() => {
  const kw = search.value.trim().toLowerCase();
  if (!kw) return props.pairs.filter((item) => item.usedAt !== null).slice(0, 10);
  return props.pairs.filter((item) => `${item.left}\u0000${item.right}`.toLowerCase().includes(kw));
});

const selectedKey = computed(() =>
  leftRoot.value && rightRoot.value ? pairKey(leftRoot.value, rightRoot.value) : "",
);

function isSelected(pair: DirPairEntry): boolean {
  return selectedKey.value !== "" && pairKey(pair.left, pair.right) === selectedKey.value;
}

function pickPair(pair: DirPairEntry): void {
  if (isSelected(pair)) return;
  emit("pickPair", pair);
}

function clearSearch(): void {
  search.value = "";
  searchInput.value?.focus();
}

const removeTarget = ref<DirPairEntry | null>(null);

function askRemove(pair: DirPairEntry): void {
  removeTarget.value = pair;
}

function confirmRemove(): void {
  const target = removeTarget.value;
  removeTarget.value = null;
  if (target) emit("removePair", target);
}
</script>

<template>
  <div class="flex h-full flex-col bg-slate-950 text-slate-200">
    <header class="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
      <span class="text-sm font-medium">扫描设置</span>
      <button
        type="button"
        class="ml-auto rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
        @click="emit('close')"
      >
        返回
      </button>
    </header>

    <section class="border-b border-slate-800 px-4 py-3">
      <div class="mx-auto flex w-full max-w-2xl flex-col gap-2 text-xs">
        <div class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">最近目录对</span>
          <div class="relative">
            <input
              ref="searchInput"
              v-model="search"
              type="text"
              placeholder="搜索路径"
              class="w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1 pr-7 text-slate-200 placeholder:text-slate-600"
            />
            <button
              v-if="search"
              type="button"
              class="absolute top-1/2 right-1 -translate-y-1/2 rounded px-1 text-slate-500 hover:text-slate-200"
              title="清空搜索"
              @click="clearSearch"
            >
              ×
            </button>
          </div>
          <span class="text-[11px] text-slate-600">{{ filteredPairs.length }} 组</span>
        </div>
        <div class="flex gap-3">
          <span class="w-20 shrink-0"></span>
          <div class="min-w-0 flex-1">
            <div v-if="filteredPairs.length > 0" class="max-h-40 space-y-1 overflow-auto">
              <div
                v-for="pair in filteredPairs"
                :key="`${pair.left}|${pair.right}`"
                class="flex items-center gap-2"
                :title="`${pair.left} ⇄ ${pair.right}`"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-2 rounded border px-2 py-1 text-left transition-colors"
                  :class="
                    isSelected(pair)
                      ? 'border-sky-700 bg-sky-600/10 text-slate-100'
                      : 'border-slate-800 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
                  "
                  @click="pickPair(pair)"
                >
                  <span class="min-w-0 flex-1 truncate text-right">{{ pair.left }}</span>
                  <span class="mx-1 shrink-0 text-slate-600">⇄</span>
                  <span class="min-w-0 flex-1 truncate">{{ pair.right }}</span>
                </button>
                <span class="flex w-4 shrink-0 justify-center">
                  <button
                    v-if="!isSelected(pair)"
                    type="button"
                    class="rounded text-rose-400 hover:text-rose-300"
                    title="删除目录对"
                    @click="askRemove(pair)"
                  >
                    ×
                  </button>
                </span>
              </div>
            </div>
            <p v-else class="text-[11px] text-slate-600">
              {{ search ? "没有匹配的目录对" : "还没有扫描成功过的目录对" }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <div class="min-h-0 flex-1 overflow-auto px-4 py-6">
      <div class="mx-auto flex w-full max-w-2xl flex-col gap-3 text-xs">
        <div class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">左侧目录</span>
          <span
            class="min-w-0 flex-1 truncate rounded border border-slate-800 bg-slate-900 px-2 py-1.5"
            :class="leftRoot ? 'text-slate-200' : 'text-slate-600'"
            :title="leftRoot"
          >
            {{ leftRoot || "未选择左侧目录" }}
          </span>
          <button
            type="button"
            class="shrink-0 rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
            title="更改左侧目录"
            @click="emit('pick', 'left')"
          >
            更改
          </button>
        </div>

        <div class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">右侧目录</span>
          <span
            class="min-w-0 flex-1 truncate rounded border border-slate-800 bg-slate-900 px-2 py-1.5"
            :class="rightRoot ? 'text-slate-200' : 'text-slate-600'"
            :title="rightRoot"
          >
            {{ rightRoot || "未选择右侧目录" }}
          </span>
          <button
            type="button"
            class="shrink-0 rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
            title="更改右侧目录"
            @click="emit('pick', 'right')"
          >
            更改
          </button>
        </div>

        <div class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">文件大小</span>
          <SizeFilter
            v-model:enabled="sizeEnabled"
            v-model:min="sizeMin"
            v-model:max="sizeMax"
            v-model:minUnit="sizeMinUnit"
            v-model:maxUnit="sizeMaxUnit"
          />
        </div>

        <label class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">目录层级</span>
          <input
            v-model.number="maxDepth"
            type="number"
            min="0"
            step="1"
            class="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
          />
          <span class="text-slate-500">层（0 不限，1 只扫根目录）</span>
        </label>

        <label class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">只含后缀</span>
          <input
            v-model="includeInput"
            type="text"
            placeholder="md, ts"
            class="w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
          />
        </label>

        <div class="flex items-center gap-3">
          <span class="w-20 shrink-0"></span>
          <ExtChips v-model="includeInput" />
        </div>

        <label class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">排除后缀</span>
          <input
            v-model="excludeInput"
            type="text"
            placeholder="log, tmp"
            class="w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
          />
        </label>

        <label class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">排除路径</span>
          <input
            v-model="excludePathsInput"
            type="text"
            placeholder="node_modules, dist"
            class="w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-600"
          />
        </label>

        <div class="flex items-start gap-3">
          <span class="w-20 shrink-0 pt-1 text-right text-slate-500">修改时间范围</span>
          <div class="flex flex-col gap-2">
            <label class="flex cursor-pointer items-center gap-2 text-slate-400">
              <input
                v-model="timeMode"
                type="radio"
                value="none"
                name="timeMode"
                class="accent-sky-500"
              />
              <span>不限</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-slate-400">
              <input
                v-model="timeMode"
                type="radio"
                value="recent"
                name="timeMode"
                class="accent-sky-500"
              />
              <span>最近</span>
              <input
                v-model.number="recentDays"
                type="number"
                min="1"
                step="1"
                aria-label="最近天数"
                :disabled="timeMode !== 'recent'"
                class="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 disabled:opacity-40"
              />
              <span class="text-slate-500">天</span>
            </label>
            <label class="flex cursor-pointer items-center gap-2 text-slate-400">
              <input
                v-model="timeMode"
                type="radio"
                value="custom"
                name="timeMode"
                class="accent-sky-500"
              />
              <span>自定义</span>
              <input
                v-model="dateFrom"
                type="date"
                aria-label="开始日期"
                :disabled="timeMode !== 'custom'"
                class="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 [color-scheme:dark] disabled:opacity-40"
              />
              <span class="text-slate-600">至</span>
              <input
                v-model="dateTo"
                type="date"
                aria-label="结束日期"
                :disabled="timeMode !== 'custom'"
                class="w-40 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 [color-scheme:dark] disabled:opacity-40"
              />
            </label>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="w-20 shrink-0 text-right text-slate-500">隐藏文件</span>
          <label class="flex cursor-pointer items-center gap-2 text-slate-400">
            <input v-model="skipHidden" type="checkbox" class="accent-sky-500" />
            <span>跳过</span>
          </label>
          <HelpMark text="隐藏文件是指以 . 开头的文件或目录" />
        </div>
      </div>
    </div>

    <footer
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500"
    >
      <span>扫描只读，不会修改任何文件</span>
      <div class="ml-auto flex items-center gap-2">
        <label class="flex cursor-pointer items-center gap-2 text-xs text-rose-300">
          <input v-model="forceRehash" type="checkbox" class="accent-rose-500" />
          <span>强制重算</span>
        </label>
        <HelpMark text="不使用哈希缓存，重新读取全部文件内容；不会修改任何文件，耗时可能较长" />
        <button
          type="button"
          class="rounded bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          @click="emit('start', forceRehash)"
        >
          开始扫描
        </button>
      </div>
    </footer>

    <div
      v-if="removeTarget"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60"
      @click.self="removeTarget = null"
    >
      <ConfirmBubble
        floating
        title="删除目录对"
        :message="`${removeTarget.left} ⇄ ${removeTarget.right}\n删除该目录对的扫描条件存档，不会修改任何文件。`"
        confirm-text="删除"
        danger
        @confirm="confirmRemove"
        @cancel="removeTarget = null"
      />
    </div>

    <div
      v-if="rehashConfirmOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60"
      @click.self="cancelForceRehash"
    >
      <ConfirmBubble
        floating
        title="强制重算"
        message="重新计算全部文件哈希，耗时可能较长。&#10;不会修改任何文件，但之前因缓存被跳过的改动会重新出现。"
        confirm-text="启用"
        danger
        @confirm="confirmForceRehash"
        @cancel="cancelForceRehash"
      />
    </div>
  </div>
</template>
