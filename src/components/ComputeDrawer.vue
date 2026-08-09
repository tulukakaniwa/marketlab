<script setup>
import { computed } from 'vue'
import MetricStrip from './MetricStrip.vue'
import ChainFlow from './ChainFlow.vue'
import FormulaDrawerContent from './FormulaDrawerContent.vue'
import FormulaChart from './FormulaChart.vue'
import FormulaNav from './FormulaNav.vue'
import WorkbenchSummary from './WorkbenchSummary.vue'

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
  // Hover 视图：指标面板预览鼠标所在 bar 的市场态；为空则回退到观察日期
  hoverMarket: { type: Object, default: null },
  hoverFormulaRow: { type: Object, default: null },
  hoverRow: { type: Object, default: null },
  hoverPrevRow: { type: Object, default: null },
  hoverDate: { type: String, default: '' },
  isHovering: { type: Boolean, default: false },
  summary: { type: Object, default: null },
})

const emit = defineEmits(['select-formula'])

// hover 时优先使用 hover 视图，否则回退到 cursor 视图
const viewMarket = computed(() => props.hoverMarket ?? props.market)
const viewDeltaBands = computed(() => {
  const fr = props.hoverFormulaRow
  // hover 时若 formulaPath 中有该行，构造一个临时 long 带；否则用 graph 当前的 deltaBands
  if (props.isHovering && fr && (Number.isFinite(fr.deltaLower) || Number.isFinite(fr.deltaUpper))) {
    return { long: { low: fr.deltaLower, high: fr.deltaUpper, cost: fr.costAnchor ?? null } }
  }
  return props.graph?.deltaBands ?? null
})

const metrics = computed(() => {
  const m = viewMarket.value
  const bands = viewDeltaBands.value
  return [
    { label: '观察价', value: money(m?.markPrice), unit: props.sourceLabel },
    { label: '成本锚', value: money(m?.costAnchor), unit: pct(m?.costDistance) },
    { label: '历史波动', value: pct(m?.annualVol), unit: `样本估计 · ATR ${pct(m?.atrPercent)}` },
    {
      label: 'GetDelta 区间',
      value: `${money(bands?.long?.low)} — ${money(bands?.long?.high)}`,
      unit: '低 / 高 · 条件情景',
    },
  ]
})

// hover 时的 OHLCV 详情条
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
      <h3 class="cd-h">
        市场快照
        <small v-if="isHovering && hoverDate" class="cd-hover-tag" :title="`鼠标悬停日期：${hoverDate}`">
          <span class="cd-hover-dot" />{{ hoverDate }}
        </small>
      </h3>
      <WorkbenchSummary :model="summary" default-open />
      <div v-if="hoverOhlcv" class="cd-hover-ohlcv" :class="`dir-${hoverOhlcv.direction}`">
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
    </section>

    <details class="cd-section cd-disclosure">
      <summary>这组数怎么来的 <small>样本 → 成本 → 波动 → 价格带 → 门禁</small></summary>
      <ChainFlow
        :graph="graph"
        :market="market"
        :active-id="activeFormulaId"
        @select="emit('select-formula', $event)"
      />
    </details>

    <section class="cd-section">
      <h3 class="cd-h">研究图 · {{ activeFormula?.label || '—' }}</h3>
      <FormulaChart
        v-if="activeFormulaId"
        :formula-id="activeFormulaId"
        :graph="graph"
        :market="market"
        :rows="rows"
        :cost-path="costPath"
        :formula-path="formulaPath"
      />
      <details v-if="activeFormulaId" class="cd-detail">
        <summary>公式、输入输出和研究边界</summary>
        <FormulaDrawerContent :formula-id="activeFormulaId" :graph="graph" :market="market" />
      </details>
    </section>

    <details class="cd-section cd-disclosure">
      <summary>更多研究模型 <small>默认不参与模拟挂单</small></summary>
      <FormulaNav :active-id="activeFormulaId" @select="emit('select-formula', $event)" />
    </details>
  </div>
</template>

<style>
.cd-drawer {
  display: grid;
  gap: 16px;
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
.cd-h {
  margin: 0;
  color: var(--green);
  font-size: 0.74rem;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cd-hover-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(14, 117, 88, 0.12);
  color: var(--green);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: none;
  font-variant-numeric: tabular-nums;
}
.cd-hover-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--green);
  animation: cd-hover-pulse 1.4s ease-in-out infinite;
}
@keyframes cd-hover-pulse {
  0%,
  100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}
/* hover OHLCV 信息条 */
.cd-hover-ohlcv {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(82px, 1fr));
  gap: 4px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(14, 117, 88, 0.04);
  font-variant-numeric: tabular-nums;
  font-size: 0.74rem;
}
.cd-hover-ohlcv.dir-up {
  border-color: rgba(14, 117, 88, 0.45);
  background: rgba(14, 117, 88, 0.06);
}
.cd-hover-ohlcv.dir-down {
  border-color: rgba(169, 50, 38, 0.45);
  background: rgba(169, 50, 38, 0.06);
}
.cd-ohlcv-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  color: var(--ink);
  font-weight: 700;
  min-width: 0;
  white-space: nowrap;
}
.cd-ohlcv-cell em {
  color: var(--muted);
  font-style: normal;
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.cd-ohlcv-cell small {
  color: var(--muted);
  font-size: 0.66rem;
  font-weight: 600;
}
.cd-hover-ohlcv.dir-up .cd-ohlcv-close,
.cd-hover-ohlcv.dir-up .cd-ohlcv-change {
  color: #0e7558;
}
.cd-hover-ohlcv.dir-up .cd-ohlcv-change small {
  color: rgba(14, 117, 88, 0.75);
}
.cd-hover-ohlcv.dir-down .cd-ohlcv-close,
.cd-hover-ohlcv.dir-down .cd-ohlcv-change {
  color: #a93226;
}
.cd-hover-ohlcv.dir-down .cd-ohlcv-change small {
  color: rgba(169, 50, 38, 0.75);
}
/* 核心快照固定两列，避免桌面窄侧栏被挤成孤行。 */
.cd-drawer .metric-strip {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  padding: 0;
}
.cd-drawer .metric-strip article {
  padding: 8px 9px;
  min-width: 0;
}
.cd-drawer .metric-strip article:first-child {
  grid-column: auto;
}
.cd-disclosure > summary,
.cd-detail > summary {
  min-height: 38px;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  color: var(--green);
  font-size: 0.76rem;
  font-weight: 900;
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
  font-size: 0.68rem;
}
.cd-disclosure[open] > summary::after,
.cd-detail[open] > summary::after {
  content: '收起';
}
.cd-disclosure > summary small {
  margin-left: auto;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 600;
}
.cd-detail {
  display: grid;
  gap: 10px;
  border-top: 1px solid var(--line);
  padding-top: 4px;
}
@media (max-width: 300px) {
  .cd-drawer .metric-strip {
    grid-template-columns: 1fr;
  }
  .cd-disclosure > summary small {
    display: none;
  }
}
</style>
