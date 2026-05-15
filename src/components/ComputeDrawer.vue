<script setup>
import { computed } from 'vue'
import MetricStrip from './MetricStrip.vue'
import ChainFlow from './ChainFlow.vue'
import FormulaDrawerContent from './FormulaDrawerContent.vue'
import FormulaChart from './FormulaChart.vue'
import FormulaNav from './FormulaNav.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  costPath: { type: Array, default: () => [] },
  sourceLabel: { type: String, default: '未载入' },
  activeFormulaId: { type: String, required: true },
  activeFormula: { type: Object, default: null },
  portfolioEnabled: { type: Boolean, default: false },
})

const emit = defineEmits(['select-formula'])

const metrics = computed(() => {
  const m = props.market; const g = props.graph
  const base = [
    { label: '现价', value: money(m?.markPrice), unit: props.sourceLabel },
    { label: '成本锚', value: money(m?.costAnchor), unit: pct(m?.costDistance) },
    { label: 'IV', value: pct(g.inputs?.iv), unit: `ATR ${pct(m?.atrPercent)}` },
    { label: '波动带', value: money(g.deltaBands?.long?.low), unit: money(g.deltaBands?.long?.high) },
  ]
  if (props.portfolioEnabled) base.push({ label: '组合研究', value: money(g.portfolio), unit: 'research-only' })
  return base
})

function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' }
</script>

<template>
  <div class="cd-drawer">
    <section class="cd-section">
      <h3 class="cd-h">五个市场指标</h3>
      <MetricStrip :items="metrics" />
    </section>

    <section class="cd-section">
      <h3 class="cd-h">计算管线</h3>
      <ChainFlow :graph="graph" :market="market" :active-id="activeFormulaId" @select="emit('select-formula', $event)" />
    </section>

    <section class="cd-section">
      <h3 class="cd-h">当前公式 · {{ activeFormula?.label || '—' }}</h3>
      <FormulaChart
        v-if="activeFormulaId"
        :formula-id="activeFormulaId"
        :graph="graph"
        :market="market"
        :rows="rows"
        :cost-path="costPath"
      />
      <FormulaDrawerContent
        v-if="activeFormulaId"
        :formula-id="activeFormulaId"
        :graph="graph"
        :market="market"
      />
    </section>

    <section class="cd-section">
      <h3 class="cd-h">完整公式列表</h3>
      <FormulaNav :active-id="activeFormulaId" @select="emit('select-formula', $event)" />
    </section>
  </div>
</template>

<style>
.cd-drawer { display: grid; gap: 16px; min-width: 0; }
.cd-drawer > * { min-width: 0; }
.cd-section { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); min-width: 0; }
.cd-section:last-child { border-bottom: none; }
.cd-h { margin: 0; color: var(--green); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
/* 5 个市场指标在窄面板（< 360px）下自动换行成 2 行 */
.cd-drawer .metric-strip { grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 4px; padding: 0; }
.cd-drawer .metric-strip article { padding: 6px 7px; min-width: 0; }
</style>
