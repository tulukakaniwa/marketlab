<script setup>
import { computed, ref } from 'vue'
import { inferTdpy } from '../domain/market-data/tdpy.js'

const props = defineProps({
  samples: { type: Array, required: true },
  currentSource: { type: Object, default: null },
  loadingSampleId: { type: String, default: '' },
})

const emit = defineEmits(['select-sample'])

const filter = ref('')
const filterInput = ref(null)

const groups = [
  { id: 'crypto', label: '加密' },
  { id: 'us', label: '美股' },
  { id: 'hk', label: '港股' },
  { id: 'cn', label: 'A 股' },
]

const groupedSamples = computed(() => {
  const buckets = { crypto: [], us: [], hk: [], cn: [] }
  for (const sample of props.samples) {
    const basis = inferTdpy(sample).basis
    if (basis in buckets) buckets[basis].push(sample)
  }
  return groups
    .map((group) => ({ ...group, items: buckets[group.id] }))
    .filter((group) => group.items.length)
})

const defaultExpandedGroupId = computed(() => {
  const source = props.currentSource
  if (source) {
    const basis = inferTdpy(source).basis
    if (groupedSamples.value.some((group) => group.id === basis)) return basis
  }
  return groupedSamples.value[0]?.id ?? null
})

const filteredGroups = computed(() => {
  const query = filter.value.trim().toLowerCase()
  if (!query) return groupedSamples.value

  return groupedSamples.value
    .map((group) => ({
      ...group,
      items: group.items.filter((sample) =>
        String(sample.symbol).toLowerCase().includes(query) ||
        String(sample.label).toLowerCase().includes(query)
      ),
    }))
    .filter((group) => group.items.length)
})

function focusFilter() {
  filterInput.value?.focus()
}

defineExpose({ focusFilter })
</script>

<template>
  <section class="market-list-panel">
    <header class="ml-head">
      <div>
        <span>Market Universe</span>
        <strong>市场列表</strong>
      </div>
      <input
        ref="filterInput"
        v-model="filter"
        type="search"
        class="ml-filter"
        placeholder="过滤代码/名称"
        aria-label="过滤标的"
      />
    </header>

    <div class="ml-body">
      <p v-if="!filteredGroups.length" class="ml-empty">无匹配标的</p>
      <details
        v-for="group in filteredGroups"
        :key="group.id"
        :open="group.id === defaultExpandedGroupId || filter.length > 0"
        class="ml-group"
      >
        <summary>
          <span>{{ group.label }}</span>
          <em>{{ group.items.length }}</em>
        </summary>
        <ul>
          <li
            v-for="sample in group.items"
            :key="sample.id"
            :class="{ active: currentSource?.id === sample.id, loading: loadingSampleId === sample.id }"
            @click="emit('select-sample', sample)"
          >
            <span class="sym">{{ sample.symbol }}</span>
            <span v-if="sample.label !== sample.symbol" class="lbl">{{ sample.label }}</span>
            <span v-if="loadingSampleId === sample.id" class="loader">载入中</span>
          </li>
        </ul>
      </details>
    </div>
  </section>
</template>

<style>
.market-list-panel { display: grid; min-height: 0; border: 1px solid var(--line); border-radius: 7px; background: var(--bg); overflow: hidden; }
.ml-head { display: grid; gap: 7px; padding: 8px; border-bottom: 1px solid var(--line); }
.ml-head div { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.ml-head span { color: var(--green); font-size: 0.6rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.ml-head strong { font-size: 0.84rem; }
.ml-filter { width: 100%; min-height: 26px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: var(--ink); font-size: 0.74rem; }
.ml-filter:focus { outline: none; border-color: var(--green); }
.ml-body { max-height: 300px; overflow-y: auto; padding: 6px 7px 8px; }
.ml-empty { margin: 8px 0; padding: 12px; color: var(--muted); font-size: 0.76rem; text-align: center; border: 1px dashed var(--line); border-radius: 6px; }
.ml-group { margin: 4px 0; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); }
.ml-group > summary { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; font-size: 0.76rem; font-weight: 800; cursor: pointer; list-style: none; }
.ml-group > summary::-webkit-details-marker { display: none; }
.ml-group summary em { color: var(--muted); font-style: normal; font-size: 0.68rem; font-variant-numeric: tabular-nums; }
.ml-group ul { list-style: none; margin: 0; padding: 2px 4px 6px; }
.ml-group li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 6px; align-items: baseline; padding: 5px 7px; border-radius: 4px; cursor: pointer; font-size: 0.72rem; }
.ml-group li:hover { background: var(--surface-active); }
.ml-group li.active { background: var(--surface-active); border-left: 2px solid var(--green); padding-left: 5px; color: var(--green); font-weight: 800; }
.ml-group li.loading { opacity: 0.6; cursor: wait; }
.ml-group .sym { font-weight: 800; font-variant-numeric: tabular-nums; }
.ml-group .lbl { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ml-group .loader { color: var(--muted); font-size: 0.64rem; }
</style>
