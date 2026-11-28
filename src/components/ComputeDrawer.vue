<script setup>
import { computed, defineAsyncComponent } from 'vue'
import MetricStrip from './MetricStrip.vue'
import ChainFlow from './ChainFlow.vue'
import FormulaDrawerContent from './FormulaDrawerContent.vue'
import FormulaChart from './FormulaChart.vue'
import FormulaNav from './FormulaNav.vue'
import WorkbenchSummary from './WorkbenchSummary.vue'
import { resolveDisplayedDeltaBand } from '../domain/formula-research/formulaAvailability.js'
import { isOptionResearchFormula } from '../domain/formula-research/optionGreeksSeries.js'

const OptionHqChart = defineAsyncComponent(() => import('./OptionHqChart.vue'))

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  rows: { type: Array, default: () => [] },
  costPath: { type: Array, default: () => [] },
  formulaPath: { type: Array, default: () => [] },
  sourceLabel: { type: String, default: '未载入' },
  activeFormulaId: { type: String, required: true },
  activeFormula: { type: Object, default: null },
  portfolioEnabled: { type: Boolean, default: false },
  hoverRow: { type: Object, default: null },
  hoverPrevRow: { type: Object, default: null },
  hoverDate: { type: String, default: '' },
  isHovering: { type: Boolean, default: false },
  summary: { type: Object, default: null },
})

const emit = defineEmits(['select-formula'])

const viewMarket = computed(() => props.market)
const viewDeltaBandState = computed(() =>
  resolveDisplayedDeltaBand({
    isHovering: false,
    currentFormulaRow: props.formulaPath.at(-1) ?? null,
    graph: props.graph,
  }),
)
const viewDeltaBands = computed(() => (viewDeltaBandState.value.long ? { long: viewDeltaBandState.value.long } : null))

const metrics = computed(() => {
  const m = viewMarket.value
  const bands = viewDeltaBands.value
  const deltaState = viewDeltaBandState.value
  return [
    { label: '观察价', value: money(m?.markPrice), unit: props.sourceLabel },
    { label: '成本锚', value: money(m?.costAnchor), unit: pct(m?.costDistance) },
    { label: '历史波动', value: pct(m?.annualVol), unit: `ATR ${pct(m?.atrPercent)}` },
    {
      label: '入场价情景 GetDelta',
      value: bands?.long ? `${money(bands.long.low)} — ${money(bands.long.high)}` : deltaState.label,
      unit: bands?.long
        ? deltaState.source === 'current-graph'
          ? 'P=入场价 · 条件情景，不等于主图成本锚路径'
          : 'P=当前成本锚 · 公式路径快照'
        : deltaState.blockedReasons.length
          ? deltaState.reasonText
          : `缺少：${deltaState.missingText}`,
    },
  ]
})

const hoverOhlcv = computed(() => {
  if (!props.isHovering || !props.hoverRow) return null
  const r = props.hoverRow
  const prev = props.hoverPrevRow
  const change = Number.isFinite(prev?.close) && Number.isFinite(r.close) ? r.close - prev.close : null
  const changePct = Number.isFinite(change) && prev?.close ? change / prev.close : null
  const direction = !Number.isFinite(change) ? 'flat' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  return {
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    change,
    changePct,
    direction,
  }
})

function money(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}
function pct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—'
}
function signedMoney(v) {
  if (!Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${money(v)}`
}
function signedPct(v) {
  if (!Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
}
function compactVolume(v) {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e8) return `${(v / 1e8).toFixed(2)}亿`
  if (abs >= 1e4) return `${(v / 1e4).toFixed(2)}万`
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(v)
}
</script>

<template>
  <div class="cd-drawer">
    <section class="cd-section">
      <div class="cd-head-row">
        <h3 class="cd-h">观察快照</h3>
        <div class="cd-tags">
          <small v-if="market?.asOfDate" class="cd-snapshot-tag">{{ market.asOfDate }}</small>
          <small v-if="isHovering && hoverDate" class="cd-hover-tag">
            <span class="cd-hover-dot" />回看 {{ hoverDate }}
          </small>
        </div>
      </div>

      <div v-if="hoverOhlcv" class="cd-hover-ohlcv" :class="`dir-${hoverOhlcv.direction}`">
        <span class="cd-hover-label">图表回看</span>
        <span class="cd-ohlcv-cell"><em>开</em>{{ money(hoverOhlcv.open) }}</span>
        <span class="cd-ohlcv-cell"><em>高</em>{{ money(hoverOhlcv.high) }}</span>
        <span class="cd-ohlcv-cell"><em>低</em>{{ money(hoverOhlcv.low) }}</span>
        <span class="cd-ohlcv-cell cd-ohlcv-close"><em>收</em>{{ money(hoverOhlcv.close) }}</span>
        <span class="cd-ohlcv-cell cd-ohlcv-change">
          <em>涨跌</em>{{ signedMoney(hoverOhlcv.change) }}
          <small>{{ signedPct(hoverOhlcv.changePct) }}</small>
        </span>
        <span class="cd-ohlcv-cell"><em>量</em>{{ compactVolume(hoverOhlcv.volume) }}</span>
      </div>

      <MetricStrip :items="metrics" />

      <ChainFlow
        :graph="graph"
        :market="market"
        :active-id="activeFormulaId"
        @select="emit('select-formula', $event)"
      />
    </section>

    <section class="cd-section">
      <div class="cd-head-row">
        <h3 class="cd-h">公式视图 · {{ activeFormula?.label || '—' }}</h3>
      </div>

      <FormulaChart
        v-if="activeFormulaId"
        :formula-id="activeFormulaId"
        :graph="graph"
        :market="market"
        :rows="rows"
        :cost-path="costPath"
        :formula-path="formulaPath"
      />
      <OptionHqChart
        v-if="isOptionResearchFormula(activeFormulaId)"
        :rows="rows"
        :source-label="sourceLabel"
        :market="market"
        :graph="graph"
        :formula-path="formulaPath"
      />
      <details v-if="activeFormulaId" class="cd-detail">
        <summary>参数定义与研究边界</summary>
        <FormulaDrawerContent
          :formula-id="activeFormulaId"
          :graph="graph"
          :market="market"
          :rows="rows"
          :cost-path="costPath"
          :formula-path="formulaPath"
        />
      </details>
    </section>

    <details class="cd-section cd-disclosure" open>
      <summary>公式目录 <small>点击切换上方图表</small></summary>
      <FormulaNav
        :active-id="activeFormulaId"
        :graph="graph"
        :market="market"
        :rows="rows"
        :cost-path="costPath"
        :formula-path="formulaPath"
        @select="emit('select-formula', $event)"
      />
    </details>

    <WorkbenchSummary v-if="summary" :model="summary" />
  </div>
</template>

<style>
.cd-drawer {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.cd-drawer > * {
  min-width: 0;
}
.cd-section {
  display: grid;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
.cd-section:last-child {
  border-bottom: none;
}
.cd-head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.cd-h {
  margin: 0;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 600;
}
.cd-tags {
  display: inline-flex;
  gap: 5px;
  align-items: center;
}
.cd-hover-tag,
.cd-snapshot-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px 7px;
  border-radius: 999px;
  font-family: var(--mono);
  font-size: 0.64rem;
  font-weight: 600;
}
.cd-hover-tag {
  background: var(--green-dim);
  color: var(--green);
}
.cd-snapshot-tag {
  background: var(--surface-alt);
  color: var(--muted);
}
.cd-hover-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--green);
  animation: cd-hover-pulse 1.4s ease-in-out infinite;
}
@keyframes cd-hover-pulse {
  0%,
  100% {
    opacity: 0.45;
  }
  50% {
    opacity: 1;
  }
}
.cd-hover-ohlcv {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(78px, 1fr));
  gap: 4px 6px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface-alt);
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.72rem;
}
.cd-hover-label {
  grid-column: 1 / -1;
  font-family: var(--font-sans);
  color: var(--muted);
  font-size: 0.62rem;
  font-weight: 600;
}
.cd-hover-ohlcv.dir-up {
  border-color: color-mix(in srgb, var(--green) 40%, transparent);
  background: color-mix(in srgb, var(--green) 6%, var(--surface-alt));
}
.cd-hover-ohlcv.dir-down {
  border-color: color-mix(in srgb, var(--red) 40%, transparent);
  background: color-mix(in srgb, var(--red) 6%, var(--surface-alt));
}
.cd-ohlcv-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  color: var(--ink);
  font-weight: 600;
  min-width: 0;
  white-space: nowrap;
}
.cd-ohlcv-cell em {
  font-family: var(--font-sans);
  color: var(--muted);
  font-style: normal;
  font-size: 0.62rem;
}
.cd-ohlcv-cell small {
  color: var(--muted);
  font-size: 0.64rem;
}
.cd-hover-ohlcv.dir-up .cd-ohlcv-close,
.cd-hover-ohlcv.dir-up .cd-ohlcv-change {
  color: var(--green);
}
.cd-hover-ohlcv.dir-down .cd-ohlcv-close,
.cd-hover-ohlcv.dir-down .cd-ohlcv-change {
  color: var(--red);
}
.cd-drawer .metric-strip {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.cd-disclosure > summary,
.cd-detail > summary {
  min-height: 28px;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  color: var(--ink-secondary);
  font-size: 0.73rem;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
}
.cd-disclosure > summary::-webkit-details-marker,
.cd-detail > summary::-webkit-details-marker {
  display: none;
}
.cd-disclosure > summary::after,
.cd-detail > summary::after {
  content: '展开';
  color: var(--muted);
  font-size: 0.66rem;
}
.cd-disclosure[open] > summary::after,
.cd-detail[open] > summary::after {
  content: '收起';
}
.cd-disclosure > summary small {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.65rem;
  font-weight: 500;
}
.cd-detail {
  display: grid;
  gap: 8px;
  border-top: 1px solid var(--line);
  padding-top: 6px;
}
</style>
