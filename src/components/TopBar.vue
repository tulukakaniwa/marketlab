<script setup>
import { computed } from 'vue'
import { Database, Moon, Sun } from 'lucide-vue-next'
import { summarizeRegime } from '../domain/decision/narrative.js'
import { deriveWindows } from '../domain/market/cost.js'
import ProfileChip from './ProfileChip.vue'

const props = defineProps({
  source: { type: Object, default: null },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  decision: { type: Object, default: null },
  confidence: { type: Number, default: 0 },
  profileId: { type: String, required: true },
  autoProfile: { type: Boolean, required: true },
  profileList: { type: Array, required: true },
  recommendedId: { type: String, default: 'balanced' },
  theme: { type: String, default: 'light' },
})

const emit = defineEmits([
  'set-profile',
  'set-auto-profile',
  'toggle-theme',
  'reset',
])

const dailyChange = computed(() => {
  const r = props.rows
  if (r.length < 2) return null
  const last = r.at(-1).close
  const prev = r.at(-2).close
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev <= 0) return null
  return (last - prev) / prev
})

const narrativeText = computed(() => {
  const m = props.market
  if (!m) return '载入 K 线后判断'
  const window = props.rows.length ? deriveWindows(props.rows.length).cost : 60
  return summarizeRegime({
    markPrice: m.markPrice,
    costAnchor: m.costAnchor,
    costDistance: m.costDistance,
    costWindow: window,
  })
})

const recommendation = computed(() => {
  const d = props.decision
  if (!d) return null
  return d.state || null
})

function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pctSign(v) {
  if (!Number.isFinite(v)) return '—'
  const sign = v >= 0 ? '+' : ''
  return `${sign}${(v * 100).toFixed(2)}%`
}
</script>

<template>
  <header class="topbar">
    <div class="tb-brand">
      <span>Market Lab</span>
      <h1>公式工作台</h1>
    </div>

    <div v-if="market" class="tb-summary">
      <div class="tb-segment tb-price">
        <strong>{{ money(market.markPrice) }}</strong>
        <em :class="{ up: (dailyChange ?? 0) >= 0, down: (dailyChange ?? 0) < 0 }">{{ pctSign(dailyChange) }}</em>
      </div>
      <div class="tb-segment tb-narrative" :title="narrativeText">{{ narrativeText }}</div>
      <div v-if="recommendation" class="tb-segment tb-action">
        <span>状态</span>
        <strong>{{ recommendation }}</strong>
        <em>强度 {{ Math.round(confidence * 100) }}%</em>
      </div>
    </div>

    <div class="tb-actions">
      <ProfileChip
        :profile-id="profileId"
        :auto-profile="autoProfile"
        :profile-list="profileList"
        :recommended-id="recommendedId"
        @set="(id) => emit('set-profile', id)"
        @set-auto="(v) => emit('set-auto-profile', v)"
      />
      <button class="tb-theme" type="button" @click="$emit('toggle-theme')" title="切换主题">
        <Moon v-if="theme === 'light'" :size="14" />
        <Sun v-else :size="14" />
      </button>
      <button class="tb-reset" type="button" @click="$emit('reset')" title="清空持久化参数">重置</button>
    </div>
  </header>
</template>

<style>
.topbar { display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center; padding: 7px 14px; background: var(--panel); border-bottom: 1px solid var(--line); flex-shrink: 0; }
.tb-brand { display: flex; flex-direction: column; gap: 1px; }
.tb-brand span { color: var(--green); font-size: 0.6rem; font-weight: 900; letter-spacing: 0.07em; text-transform: uppercase; }
.tb-brand h1 { margin: 0; font-size: 0.96rem; line-height: 1; }
.tb-summary { display: flex; gap: 14px; align-items: center; min-width: 0; }
.tb-segment { display: inline-flex; gap: 5px; align-items: baseline; padding: 0 10px; border-left: 1px solid var(--line); white-space: nowrap; }
.tb-segment:first-child { border-left: none; padding-left: 0; }
.tb-price strong { font-size: 1rem; font-variant-numeric: tabular-nums; font-weight: 800; }
.tb-price em { font-style: normal; font-size: 0.78rem; font-weight: 700; }
.tb-price em.up { color: var(--green); }
.tb-price em.down { color: var(--red); }
.tb-narrative { color: var(--ink); font-size: 0.85rem; line-height: 1.3; max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tb-action span { color: var(--muted); font-size: 0.6rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
.tb-action strong { font-size: 0.86rem; font-weight: 800; }
.tb-action em { font-style: normal; color: var(--muted); font-size: 0.7rem; font-variant-numeric: tabular-nums; }
.tb-actions { display: flex; gap: 6px; align-items: center; }
.tb-theme { min-width: 28px; min-height: 28px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: var(--ink); cursor: pointer; }
.tb-theme:hover { border-color: var(--green); }
.tb-reset { min-height: 26px; padding: 1px 9px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.66rem; cursor: pointer; opacity: 0.7; }
.tb-reset:hover { opacity: 1; border-color: var(--green); }

@media (max-width: 1100px) {
  .tb-summary .tb-action { display: none; }
}
@media (max-width: 800px) {
  .tb-summary .tb-narrative { display: none; }
}
</style>
