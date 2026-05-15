<script setup>
import { computed } from 'vue'
import { deviationScore, netCarry, netLpEfficiency, riskSurface } from '../domain/formulas/core.js'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  activeId: { type: String, default: 'delta-band' },
})

const emit = defineEmits(['select'])

/* ── Layer 1: 基础管线 ── */
const pipeline = computed(() => [
  { id: 'path', label: '路径', val: props.market?.rows ? `${props.market.rows}条` : '—' },
  { id: 'cost', label: '成本', val: fmt(props.market?.costAnchor), sub: pctFmt(props.market?.costDistance), tone: (props.market?.costDistance ?? 0) < 0 ? 'lo' : 'hi' },
  { id: 'volatility', label: '波动', val: pctFmt(props.market?.annualVol), sub: `ATR ${pctFmt(props.market?.atrPercent)}` },
  { id: 'delta-band', label: 'Δ带', val: fmt(props.graph.deltaBands?.long?.low), sub: fmt(props.graph.deltaBands?.long?.high), tone: 'band' },
  { id: 'option-greeks', label: 'Greeks', val: fmt(props.graph.option?.price), sub: `Δ ${f4(props.graph.option?.delta)}`, tone: (props.graph.option?.delta ?? 0) > 0 ? 'up' : 'down' },
  { id: 'lp-inventory', label: 'LP库', val: fmt(props.graph.lpV3?.value), sub: `IL ${pctFmt(props.graph.impermanentLoss?.impermanentLoss)}` },
  { id: 'portfolio', label: '组合', val: fmt(props.graph.portfolio), sub: '研究', tone: 'band' },
  { id: 'order-plan', label: '挂单', val: props.graph.plan?.primaryOrders?.length ? `${props.graph.plan.primaryOrders.length}档` : '—', sub: props.graph.decision?.state ?? '等待' },
])

/* ── Layer 2: 融合 ── */
const fusion = computed(() => {
  const m = props.market; const g = props.graph
  const ds = deviationScore({ costDistance: m?.costDistance, annualVol: m?.annualVol, holdingDays: g.inputs?.holdingDays })
  const nc = netCarry({ costDistance: m?.costDistance, fundingRate: g.funding?.funding, holdingDays: g.inputs?.holdingDays })
  const nl = netLpEfficiency({ capitalEfficiency: g.efficiency?.efficiency, impermanentLoss: g.impermanentLoss?.impermanentLoss, feeRate: 0.003 })
  return [
    { id: 'deviation-score', label: '偏离强度', val: ds ? `${ds.z.toFixed(2)}σ` : '—', sub: ds ? `${(ds.regressionProb * 100).toFixed(0)}%回归` : '', tone: ds?.regime === '折价' ? 'lo' : 'hi', sources: ['cost', 'volatility'] },
    { id: 'risk-surface', label: '风险曲面', val: 'Greeks×Δ带', sub: '曲面', tone: 'band', sources: ['delta-band', 'option-greeks'] },
    { id: 'net-lp-efficiency', label: 'LP净效率', val: nl ? `${nl.totalNet.toFixed(1)}×` : '—', sub: '研究层', tone: 'band', sources: ['lp-inventory', 'capital-efficiency'] },
    { id: 'net-carry', label: '持仓净收', val: nc ? pctFmt(nc.netReturn) : '—', sub: '研究层', tone: 'band', sources: ['cost', 'funding'] },
  ]
})

function fmt(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function f4(v) { return Number.isFinite(v) ? v.toFixed(4) : '—' }
function pctFmt(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '—' }

function nClass(n) {
  if (!n.tone) return ''
  return n.tone === 'lo' ? 'cf-lo' : n.tone === 'hi' ? 'cf-hi' : n.tone === 'up' ? 'cf-up' : n.tone === 'down' ? 'cf-down' : n.tone === 'band' ? 'cf-band' : ''
}
</script>

<template>
  <div class="cf-strip">
    <!-- Layer 1: Pipeline -->
    <div class="cf-layer">
      <span class="cf-layer-tag">基础管线</span>
      <template v-for="(n, i) in pipeline" :key="n.id">
        <button :class="['cf-node', nClass(n), { active: n.id === activeId }]" @click="emit('select', n.id)">
          <span class="cf-label">{{ n.label }}</span>
          <span class="cf-val">{{ n.val }}</span>
          <span v-if="n.sub" class="cf-sub">{{ n.sub }}</span>
        </button>
        <span v-if="i < pipeline.length - 1" class="cf-arrow">→</span>
      </template>
    </div>

    <!-- Layer 2: Fusion -->
    <div class="cf-layer">
      <span class="cf-layer-tag fusion">公式融合</span>
      <template v-for="(n, i) in fusion" :key="n.id">
        <span v-if="i > 0" class="cf-arrow">+</span>
        <button :class="['cf-node', 'cf-fusion', nClass(n), { active: n.id === activeId }]" @click="emit('select', n.id)">
          <span class="cf-label">{{ n.label }}</span>
          <span class="cf-val">{{ n.val }}</span>
          <span v-if="n.sub" class="cf-sub">{{ n.sub }}</span>
          <span class="cf-src">{{ n.sources?.join('×') }}</span>
        </button>
      </template>
    </div>
  </div>
</template>

<style>
.cf-strip { display: flex; flex-direction: column; gap: 2px; padding: 4px 8px; border-bottom: 1px solid var(--line); background: var(--panel); }
.cf-layer { display: flex; align-items: flex-start; gap: 0; min-height: 32px; overflow-x: auto; }
.cf-layer-tag { flex-shrink: 0; font-size: 0.52rem; font-weight: 900; color: var(--green); letter-spacing: 0.05em; text-transform: uppercase; padding: 8px 8px 0 0; min-width: 40px; text-align: right; }
.cf-layer-tag.fusion { color: var(--blue); }

.cf-node { display: grid; gap: 1px; justify-items: center; min-width: 62px; border: 1px solid transparent; border-radius: 5px; padding: 4px 6px; background: transparent; color: var(--ink); cursor: pointer; flex-shrink: 0; transition: background 0.1s; }
.cf-node:hover { background: var(--surface-alt); }
.cf-node.active { border-color: var(--green); background: var(--surface-active); }
.cf-fusion { border-style: dashed; border-color: transparent; background: var(--surface-alt); }
.cf-fusion:hover { border-color: var(--blue); border-style: dashed; }
.cf-fusion.active { border-color: var(--blue); border-style: dashed; background: var(--surface-active); }

.cf-label { font-size: 0.56rem; font-weight: 900; color: var(--green); letter-spacing: 0.03em; text-transform: uppercase; }
.cf-val { font-size: 0.72rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.cf-sub { font-size: 0.56rem; color: var(--muted); }
.cf-src { font-size: 0.5rem; color: var(--muted); font-style: italic; letter-spacing: 0.03em; }
.cf-arrow { font-size: 0.62rem; color: var(--muted); padding: 9px 3px 0; flex-shrink: 0; }

.cf-lo .cf-val { color: var(--blue); }
.cf-hi .cf-val { color: var(--red); }
.cf-up .cf-val { color: var(--green); }
.cf-down .cf-val { color: var(--red); }
.cf-band .cf-val { color: var(--blue); }
</style>
