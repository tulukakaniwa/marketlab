<script setup>
import { computed, ref } from 'vue'
import { inferTdpy } from '../domain/market-data/tdpy.js'

const props = defineProps({
  open: { type: Boolean, required: true },
  samples: { type: Array, required: true },
  currentSource: { type: Object, default: null },
  loadingSampleId: { type: String, default: '' },
})

const emit = defineEmits(['toggle', 'select-sample'])

const filter = ref('')
const collapsedGroupIds = ref(new Set())

const GROUP_META = [
  { id: 'crypto', label: '加密', icon: '🪙' },
  { id: 'us',     label: '美股', icon: '📈' },
  { id: 'hk',     label: '港股', icon: '🇭🇰' },
  { id: 'cn',     label: 'A 股', icon: '🇨🇳' },
]

// 按市场分组（不含 fallback：fallback 多为未识别样本，不显示）
const groupedSamples = computed(() => {
  const buckets = { crypto: [], us: [], hk: [], cn: [] }
  for (const s of props.samples) {
    const basis = inferTdpy(s).basis
    if (basis in buckets) buckets[basis].push(s)
  }
  return GROUP_META
    .map((g) => ({ ...g, items: buckets[g.id] }))
    .filter((g) => g.items.length > 0)
})

// 过滤后的分组（按 symbol 或 label 不区分大小写包含匹配；空组隐藏）
const filteredGroups = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return groupedSamples.value
  return groupedSamples.value
    .map((g) => ({
      ...g,
      items: g.items.filter((s) =>
        String(s.symbol).toLowerCase().includes(q) ||
        String(s.label).toLowerCase().includes(q)
      ),
    }))
    .filter((g) => g.items.length > 0)
})

function onSelect(s) {
  emit('select-sample', s)
}

function isGroupOpen(groupId) {
  return filter.value.length > 0 || !collapsedGroupIds.value.has(groupId)
}

function onGroupToggle(groupId, event) {
  if (filter.value.length > 0) return
  const next = new Set(collapsedGroupIds.value)
  if (event.target.open) next.delete(groupId)
  else next.add(groupId)
  collapsedGroupIds.value = next
}
</script>

<template>
  <aside class="rp" :class="{ open, collapsed: !open }">
    <!-- 折叠态 -->
    <button
      v-if="!open"
      type="button"
      class="rp-edge"
      title="展开市场列表"
      @click="emit('toggle')"
    >
      <span class="rp-edge-icon">◀</span>
      <span class="rp-edge-text">市场</span>
    </button>

    <!-- 展开态 -->
    <template v-else>
      <header class="rp-head">
        <input
          v-model="filter"
          type="search"
          class="rp-filter"
          placeholder="过滤代码/名称…"
          aria-label="过滤标的"
        />
        <button class="rp-collapse" type="button" aria-label="收起右侧面板" title="收起" @click="emit('toggle')">▶</button>
      </header>

      <div class="rp-body">
        <p v-if="!filteredGroups.length" class="rp-empty">无匹配标的</p>
        <details
          v-for="g in filteredGroups"
          :key="g.id"
          :open="isGroupOpen(g.id)"
          class="rp-group"
          @toggle="onGroupToggle(g.id, $event)"
        >
          <summary>
            <span class="rp-g-label">{{ g.icon }} {{ g.label }}</span>
            <em class="rp-g-count">{{ g.items.length }}</em>
          </summary>
          <ul>
            <li
              v-for="s in g.items"
              :key="s.id"
              :class="{
                active: currentSource?.id === s.id,
                loading: loadingSampleId === s.id,
              }"
              @click="onSelect(s)"
            >
              <span class="sym">{{ s.symbol }}</span>
              <span v-if="s.label !== s.symbol" class="lbl">{{ s.label }}</span>
              <span v-if="loadingSampleId === s.id" class="loader">载入中…</span>
            </li>
          </ul>
        </details>
      </div>
    </template>
  </aside>
</template>

<style>
.rp { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--line); overflow: hidden; }

/* 折叠态 */
.rp-edge { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 8px; padding: 12px 0; border: none; background: transparent; color: var(--ink); cursor: pointer; }
.rp-edge:hover { background: var(--surface-active); color: var(--green); }
.rp-edge-icon { font-size: 0.78rem; }
.rp-edge-text { writing-mode: vertical-rl; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.06em; }

/* 展开态 head */
.rp-head { display: flex; align-items: center; gap: 6px; padding: 7px 8px 7px 10px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.rp-filter { flex: 1; min-width: 0; min-height: 24px; padding: 2px 7px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.74rem; }
.rp-filter:focus { outline: none; border-color: var(--green); }
.rp-collapse { width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.72rem; cursor: pointer; flex-shrink: 0; }
.rp-collapse:hover { border-color: var(--green); color: var(--green); }

/* 展开态 body */
.rp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 8px 10px; }
.rp-empty { margin: 12px 4px; padding: 14px; color: var(--muted); font-size: 0.78rem; text-align: center; border: 1px dashed var(--line); border-radius: 6px; }
.rp-group { margin: 4px 0; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); }
.rp-group > summary { display: flex; justify-content: space-between; align-items: center; padding: 6px 9px; font-size: 0.78rem; font-weight: 800; cursor: pointer; list-style: none; }
.rp-group > summary::-webkit-details-marker { display: none; }
.rp-g-label { line-height: 1.2; }
.rp-g-count { font-style: normal; color: var(--muted); font-size: 0.7rem; font-variant-numeric: tabular-nums; }
.rp-group ul { list-style: none; margin: 0; padding: 2px 4px 6px; }
.rp-group li { display: grid; grid-template-columns: auto 1fr auto; gap: 6px; align-items: baseline; padding: 5px 8px; border-radius: 4px; cursor: pointer; font-size: 0.74rem; }
.rp-group li:hover { background: var(--surface-active); }
.rp-group li.active { background: var(--surface-active); border-left: 2px solid var(--green); padding-left: 6px; color: var(--green); font-weight: 800; }
.rp-group li.loading { opacity: 0.6; cursor: wait; }
.rp-group li .sym { font-weight: 800; font-variant-numeric: tabular-nums; }
.rp-group li .lbl { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-group li .loader { color: var(--muted); font-size: 0.66rem; }
</style>
