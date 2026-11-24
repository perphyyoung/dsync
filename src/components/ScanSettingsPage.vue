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
const includeKeywordInput = defineModel<string>("includeKeywordInput", { required: true });
const excludeKeywordInput = defineModel<string>("excludeKeywordInput", { required: true });
const timeMode = defineModel<TimeMode>("timeMode", { required: true });
const dateFrom = defineModel<string>("dateFrom", { required: true });
const dateTo = defineModel<string>("dateTo", { required: true });
const recentDays = defineModel<number>("recentDays", { required: true });
const skipHidden = defineModel<boolean>("skipHidden", { required: true });
const scanThreads = defineModel<number>("scanThreads", { required: true });
const scanThreadsAuto = defineModel<boolean>("scanThreadsAuto", { required: true });

const props = defineProps<{ pairs: DirPairEntry[]; logicalProcessors: number }>();

const emit = defineEmits<{
  pick: [side: Side];
  pickPair: [pair: DirPairEntry];
  removePair: [pair: DirPairEntry];
  start: [forceRehash: boolean];
  scanThreadsChange: [value: number];
  resetScanThreads: [];
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

/** 无关键词显示最近 5 组；输入后搜索全部档案，结果同样最多 5 条 */
const filteredPairs = computed(() => {
  const kw = search.value.trim().toLowerCase();
  /* 最近目录对最多显示 5 组：无关键词取最近 5 组，搜索后也取前 5 条 */
  if (!kw) return props.pairs.filter((item) => item.usedAt !== null).slice(0, 5);
  return props.pairs
    .filter((item) => `${item.left}\u0000${item.right}`.toLowerCase().includes(kw))
    .slice(0, 5);
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
    <header class="flex items-center gap-3 border-b border-slate-800 px-6 py-3">
      <h2 class="text-sm font-medium text-slate-100">扫描设置</h2>
      <button
        type="button"
        class="ml-auto rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
        @click="emit('close')"
      >
        返回
      </button>
    </header>

    <section class="border-b border-slate-800 px-6 py-3">
      <div class="flex w-full flex-col gap-2 text-sm">
        <div class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">最近目录对</span>
          <div class="relative">
            <input
              ref="searchInput"
              v-model="search"
              type="text"
              placeholder="搜索路径"
              class="h-8 w-64 rounded-md border border-slate-700 bg-slate-950 px-2 pr-7 text-slate-200 transition-colors placeholder:text-slate-600 hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
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
          <span class="text-xs text-slate-500">{{ filteredPairs.length }} 组</span>
        </div>
        <div class="flex gap-3">
          <span class="w-36 shrink-0"></span>
          <div class="min-w-0 flex-1">
            <div v-if="filteredPairs.length > 0" class="space-y-1">
              <div
                v-for="pair in filteredPairs"
                :key="`${pair.left}|${pair.right}`"
                class="flex items-center gap-2"
                :title="`${pair.left} ⇄ ${pair.right}`"
              >
                <button
                  type="button"
                  data-testid="pair-button"
                  class="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border px-2 text-left transition-colors"
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
            <p v-else class="text-xs text-slate-500">
              {{ search ? "没有匹配的目录对" : "还没有扫描成功过的目录对" }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <div class="min-h-0 flex-1 overflow-auto px-6 py-5">
      <div class="flex w-full flex-col gap-2 text-sm">
        <h3 class="px-2 text-xs font-medium text-slate-300">目录</h3>
        <div class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">左侧目录</span>
          <span
            data-testid="left-path"
            class="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border border-slate-700 bg-slate-950 px-2"
            :class="leftRoot ? 'text-slate-200' : 'text-slate-600'"
            :title="leftRoot"
          >
            {{ leftRoot || "未选择左侧目录" }}
          </span>
          <button
            type="button"
            class="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
            title="更改左侧目录"
            @click="emit('pick', 'left')"
          >
            更改
          </button>
        </div>

        <div class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">右侧目录</span>
          <span
            data-testid="right-path"
            class="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border border-slate-700 bg-slate-950 px-2"
            :class="rightRoot ? 'text-slate-200' : 'text-slate-600'"
            :title="rightRoot"
          >
            {{ rightRoot || "未选择右侧目录" }}
          </span>
          <button
            type="button"
            class="shrink-0 rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 transition-colors hover:bg-slate-800 active:bg-slate-700"
            title="更改右侧目录"
            @click="emit('pick', 'right')"
          >
            更改
          </button>
        </div>

        <h3 class="mt-3 border-t border-slate-800 px-2 pt-3 text-xs font-medium text-slate-300">
          扫描条件
        </h3>
        <label class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">目录层级</span>
          <input
            v-model.number="maxDepth"
            type="number"
            min="0"
            step="1"
            class="h-8 w-24 rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-200 transition-colors hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          />
          <span class="text-slate-500">层</span>
          <HelpMark text="0 不限，1 只扫根目录" />
        </label>

        <label class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">只含关键字</span>
          <input
            v-model="includeKeywordInput"
            type="text"
            placeholder="输入单个词来命中"
            class="h-8 w-[50vw] rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-200 transition-colors placeholder:text-slate-600 hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          />
        </label>

        <label class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">排除关键字</span>
          <input
            v-model="excludeKeywordInput"
            type="text"
            placeholder="输入单个词来排除"
            class="h-8 w-[50vw] rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-200 transition-colors placeholder:text-slate-600 hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          />
        </label>

        <div class="flex items-center gap-3">
          <label class="flex min-w-0 items-center gap-3">
            <span class="w-36 shrink-0 text-right text-slate-400">只含后缀</span>
            <input
              v-model="includeInput"
              type="text"
              placeholder="md, ts"
              class="h-8 w-[50vw] rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-200 transition-colors placeholder:text-slate-600 hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            />
          </label>
          <ExtChips v-model="includeInput" />
        </div>

        <label class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">排除后缀</span>
          <input
            v-model="excludeInput"
            type="text"
            placeholder="log, tmp"
            class="h-8 w-[50vw] rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-200 transition-colors placeholder:text-slate-600 hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
          />
        </label>

        <div class="flex items-start gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">修改日期范围</span>
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
                class="h-8 w-16 rounded-md border border-slate-700 bg-slate-950 px-2 text-right text-slate-200 transition-colors disabled:opacity-40 hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
              />
              <span class="text-slate-400">天</span>
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
                class="h-8 w-40 rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-200 transition-colors [color-scheme:dark] disabled:opacity-40 hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
              />
              <span class="text-slate-500">至</span>
              <input
                v-model="dateTo"
                type="date"
                aria-label="结束日期"
                :disabled="timeMode !== 'custom'"
                class="h-8 w-40 rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-200 transition-colors [color-scheme:dark] disabled:opacity-40 hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
              />
            </label>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">文件大小</span>
          <SizeFilter
            v-model:enabled="sizeEnabled"
            v-model:min="sizeMin"
            v-model:max="sizeMax"
            v-model:minUnit="sizeMinUnit"
            v-model:maxUnit="sizeMaxUnit"
          />
        </div>

        <div class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">跳过隐藏文件</span>
          <input v-model="skipHidden" type="checkbox" class="accent-sky-500" />
          <HelpMark text="勾选后，跳过以 . 开头的文件与目录" />
        </div>

        <h3 class="mt-3 border-t border-slate-800 px-2 pt-3 text-xs font-medium text-slate-300">
          性能
        </h3>
        <div class="flex items-center gap-3">
          <span class="w-36 shrink-0 text-right text-slate-400">扫描线程数</span>
          <input
            v-model.number="scanThreads"
            type="number"
            min="1"
            :max="logicalProcessors"
            aria-label="扫描线程数"
            class="h-8 w-24 rounded-md border border-slate-700 bg-slate-950 px-2 text-slate-200 transition-colors hover:border-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500"
            @change="emit('scanThreadsChange', scanThreads)"
          />
          <span class="text-slate-500">/ {{ logicalProcessors }} 逻辑处理器</span>
          <button
            v-if="!scanThreadsAuto"
            type="button"
            class="text-xs text-sky-400 hover:text-sky-300"
            @click="emit('resetScanThreads')"
          >
            恢复默认
          </button>
          <HelpMark
            text="应用级设置，对所有目录对生效；默认取逻辑处理器的一半。控制扫描时的并行线程数，机械硬盘建议调低。"
          />
        </div>
      </div>
    </div>

    <footer
      class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-800 px-6 py-2.5 text-xs text-slate-500"
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
          class="rounded-md bg-sky-600 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-500 active:bg-sky-700"
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
