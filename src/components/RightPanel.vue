<script setup>
import { computed, ref } from 'vue'
import { Search, X, PanelRightClose, PanelRightOpen, ChevronRight } from 'lucide-vue-next'
import { inferTdpy } from '../domain/market-data/tdpy.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'

const { isCompact } = useBreakpoint()

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
  { id: 'crypto', label: '加密现货', code: 'CRYPTO' },
  { id: 'us', label: '美股市场', code: 'US' },
  { id: 'hk', label: '港股市场', code: 'HK' },
  { id: 'cn', label: 'A股市场', code: 'CN' },
]

const groupedSamples = computed(() => {
  const buckets = { crypto: [], us: [], hk: [], cn: [] }
  for (const s of props.samples) {
    const basis = inferTdpy(s).basis
    if (basis in buckets) buckets[basis].push(s)
  }
  return GROUP_META.map((g) => ({ ...g, items: buckets[g.id] })).filter((g) => g.items.length > 0)
})

const filteredGroups = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return groupedSamples.value
  return groupedSamples.value
    .map((g) => ({
      ...g,
      items: g.items.filter(
        (s) => String(s.symbol).toLowerCase().includes(q) || String(s.label).toLowerCase().includes(q),
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
  <aside
    class="rp"
    :class="{
      open,
      collapsed: !open,
      'rp-mobile': isCompact,
      'rp-mobile-open': isCompact && open,
    }"
    :role="isCompact && open ? 'dialog' : null"
    :aria-modal="isCompact && open ? 'true' : undefined"
    :aria-hidden="isCompact && !open ? 'true' : undefined"
    :inert="isCompact && !open"
    aria-label="标的列表面板"
  >
    <button v-if="isCompact" class="rp-mobile-close" type="button" aria-label="关闭" @click="emit('toggle')">
      <X :size="18" />
    </button>

    <button v-if="!open" type="button" class="rp-edge" title="展开市场列表" @click="emit('toggle')">
      <PanelRightOpen :size="15" />
      <span class="rp-edge-text">标的</span>
    </button>

    <template v-else>
      <header class="rp-head">
        <div class="rp-search-box">
          <Search :size="13" class="rp-search-icon" />
          <input v-model="filter" type="search" class="rp-filter" placeholder="搜索代码或名称…" aria-label="过滤标的" />
          <button v-if="filter" type="button" class="rp-clear" aria-label="清空过滤" @click="filter = ''">
            <X :size="12" />
          </button>
        </div>
        <button class="rp-collapse" type="button" aria-label="收起右侧面板" title="收起面板" @click="emit('toggle')">
          <PanelRightClose :size="14" />
        </button>
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
            <span class="rp-g-left">
              <ChevronRight :size="12" class="rp-g-chevron" />
              <code class="rp-g-code">{{ g.code }}</code>
              <span class="rp-g-label">{{ g.label }}</span>
            </span>
            <em class="rp-g-count">{{ g.items.length }}</em>
          </summary>
          <ul>
            <li v-for="s in g.items" :key="s.id">
              <button
                type="button"
                class="rp-item"
                :class="{
                  active: currentSource?.id === s.id,
                  loading: loadingSampleId === s.id,
                }"
                :aria-current="currentSource?.id === s.id ? 'true' : undefined"
                :aria-busy="loadingSampleId === s.id ? 'true' : undefined"
                @click="onSelect(s)"
              >
                <span class="sym">{{ s.symbol }}</span>
                <span v-if="s.label !== s.symbol" class="lbl">{{ s.label }}</span>
                <span v-if="loadingSampleId === s.id" class="loader">载入…</span>
              </button>
            </li>
          </ul>
        </details>
      </div>
    </template>
  </aside>
</template>

<style>
.rp {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-left: 1px solid var(--line);
  overflow: hidden;
}

.rp-edge {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 12px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
}
.rp-edge:hover {
  background: var(--surface-hover);
  color: var(--green);
}
.rp-edge-text {
  writing-mode: vertical-rl;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.rp-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.rp-search-box {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  height: 30px;
  border-radius: var(--r-sm);
  background: var(--bg);
  border: 1px solid var(--line);
}
.rp-search-box:focus-within {
  border-color: var(--green);
  box-shadow: 0 0 0 2px var(--green-dim);
}
.rp-search-icon {
  color: var(--muted);
  flex-shrink: 0;
}
.rp-filter {
  flex: 1;
  min-width: 0;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  background: transparent !important;
  color: var(--ink);
  font-size: 0.75rem;
}
.rp-filter::-webkit-search-cancel-button {
  display: none;
}
.rp-clear {
  width: 18px;
  height: 18px;
  min-height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
}
.rp-collapse {
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  flex-shrink: 0;
}
.rp-collapse:hover {
  background: var(--surface-hover);
  color: var(--ink);
}

.rp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 4px 6px 10px;
}
.rp-empty {
  margin: 12px 4px;
  padding: 16px;
  color: var(--muted);
  font-size: 0.75rem;
  text-align: center;
  border-radius: var(--r-md);
  background: var(--surface-alt);
}
.rp-group {
  margin: 2px 0 6px;
}
.rp-group > summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 6px;
  border-radius: var(--r-xs);
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--muted);
  cursor: pointer;
  list-style: none;
}
.rp-group > summary:hover {
  background: var(--surface-hover);
  color: var(--ink);
}
.rp-group > summary::-webkit-details-marker {
  display: none;
}
.rp-g-left {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.rp-g-chevron {
  transition: transform 140ms ease;
}
.rp-group[open] .rp-g-chevron {
  transform: rotate(90deg);
}
.rp-g-code {
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--surface-alt);
  color: var(--green);
}
.rp-g-count {
  font-style: normal;
  font-family: var(--mono);
  color: var(--muted);
  font-size: 0.68rem;
}
.rp-group ul {
  list-style: none;
  margin: 2px 0 0;
  padding: 0;
}
.rp-item {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 8px;
  align-items: baseline;
  width: 100%;
  min-width: 0;
  min-height: 29px;
  border: none;
  border-radius: var(--r-xs);
  padding: 4px 8px;
  background: transparent;
  color: var(--ink);
  font-size: 0.74rem;
  font-weight: 500;
  text-align: left;
}
.rp-item:hover {
  background: var(--surface-hover);
}
.rp-item.active {
  background: var(--surface-active);
  color: var(--green);
}
.rp-item .sym {
  font-family: var(--mono);
  font-weight: 600;
  font-size: 0.75rem;
}
.rp-item .lbl {
  color: var(--muted);
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.rp-item.active .lbl {
  color: color-mix(in srgb, var(--green) 80%, var(--ink));
}
.rp-item .loader {
  color: var(--muted);
  font-size: 0.64rem;
}

.rp-mobile-close {
  display: none;
}

@media (max-width: 1279px) {
  .rp.rp-mobile {
    position: fixed;
    top: 0;
    right: 0;
    width: min(340px, 88vw);
    height: 100vh;
    height: 100dvh;
    z-index: 50;
    background: var(--panel);
    transform: translateX(100%);
    transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: var(--shadow-pop);
  }
  .rp.rp-mobile.rp-mobile-open {
    transform: translateX(0);
  }
  .rp.rp-mobile .rp-mobile-close {
    display: grid;
    place-items: center;
    position: absolute;
    top: 10px;
    left: 10px;
    width: 36px;
    height: 36px;
    padding: 0;
    z-index: 51;
  }
  .rp.rp-mobile .rp-head {
    min-height: 56px;
    padding-left: 52px;
  }
  .rp.rp-mobile .rp-item {
    min-height: 38px;
  }
  .rp.rp-mobile .rp-collapse {
    display: none;
  }
}
</style>
