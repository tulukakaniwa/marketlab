<script setup>
import { computed } from 'vue'
import { liquidityFingerprint } from '../domain/formulas/core.js'

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  graph: { type: Object, required: true },
  activeIndex: { type: Number, required: true },
})

const visibleWindow = 120

const activeRow = computed(() => props.rows[props.activeIndex] ?? props.rows.at(-1))
const activeCost = computed(() => props.costPath[props.activeIndex] ?? props.costPath.at(-1))
const activeFormula = computed(() => props.formulaPath[props.activeIndex] ?? props.formulaPath.at(-1))
const orders = computed(() => props.graph?.plan?.primaryOrders ?? [])

const priceRange = computed(() => {
  const end = Math.max(0, props.activeIndex) + 1
  const rows = props.rows.slice(Math.max(0, end - visibleWindow), end)
  const prices = rows.flatMap((row) => [row.high, row.low, row.close])
  prices.push(activeCost.value?.lower, activeCost.value?.upper, activeCost.value?.anchor)
  prices.push(activeFormula.value?.deltaLower, activeFormula.value?.deltaUpper)
  for (const order of orders.value) prices.push(order.price)
  const finite = prices.filter((value) => Number.isFinite(value) && value > 0)
  const fallback = activeRow.value?.close ?? props.graph?.inputs?.entryPrice ?? 1
  if (!finite.length) return { lower: fallback * 0.9, upper: fallback * 1.1 }
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const pad = Math.max((max - min) * 0.08, fallback * 0.015)
  return { lower: Math.max(0.0001, min - pad), upper: max + pad }
})

const fingerprint = computed(() => {
  const basis = activeCost.value?.anchor || activeRow.value?.close || props.graph?.inputs?.entryPrice
  if (!Number.isFinite(basis) || basis <= 0) return null
  const { lower, upper } = priceRange.value
  return liquidityFingerprint({
    entryPrice: basis,
    priceGrid: 96,
    distribution: 'log-laplace',
    lowerFactor: Math.max(0.05, lower / basis),
    upperFactor: Math.min(20, upper / basis),
    lambda: 2,
    kappa: 1,
  })
})

const rackBins = computed(() => {
  const fp = fingerprint.value
  if (!fp?.segments?.length) return []
  const maxWeight = Math.max(...fp.segments.map((seg) => seg.weight), 0.001)
  return fp.segments.map((seg) => ({
    ...seg,
    top: priceToY(seg.upper),
    bottom: priceToY(seg.lower),
    width: Math.max(8, (seg.weight / maxWeight) * 100),
    label: `${(seg.weight * 100).toFixed(0)}%`,
  }))
})

const markers = computed(() => [
  marker('现价', activeRow.value?.close, 'price'),
  marker('成本', activeCost.value?.anchor, 'cost'),
  marker('Δ下', activeFormula.value?.deltaLower, 'band'),
  marker('Δ上', activeFormula.value?.deltaUpper, 'band'),
].filter(Boolean))

const orderTicks = computed(() => orders.value
  .filter((order) => Number.isFinite(order.price) && order.price > 0)
  .map((order) => ({
    ...order,
    y: priceToY(order.price),
    width: Math.min(100, Math.max(16, (order.notional / maxOrderNotional.value) * 100)),
  })))

const maxOrderNotional = computed(() => Math.max(...orders.value.map((order) => order.notional || 0), 1))
const concentration = computed(() => {
  const max = Math.max(...rackBins.value.map((bin) => bin.weight), 0)
  return Number.isFinite(max) ? max : 0
})

function marker(label, price, tone) {
  if (!Number.isFinite(price) || price <= 0) return null
  return { label, price, tone, y: priceToY(price) }
}

function priceToY(price) {
  const { lower, upper } = priceRange.value
  if (!Number.isFinite(price) || upper <= lower) return 50
  const pct = ((upper - price) / (upper - lower)) * 100
  return Math.max(1, Math.min(99, pct))
}

function fmt(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
    : '—'
}
</script>

<template>
  <aside class="lf-rack" aria-label="流动性指纹挂单分布">
    <header class="lf-head">
      <div>
        <span>流动性指纹</span>
        <strong>挂单分布仓</strong>
      </div>
      <div class="lf-tags">
        <em>订单流辅助</em>
        <em>研究层</em>
      </div>
    </header>

    <div class="lf-scale">
      <span>{{ fmt(priceRange.upper) }}</span>
      <span>{{ fmt(priceRange.lower) }}</span>
    </div>

    <div class="lf-board">
      <div
        v-for="bin in rackBins"
        :key="`${bin.lower}-${bin.upper}`"
        class="lf-bin"
        :style="{
          top: `${bin.top}%`,
          height: `${Math.max(2, bin.bottom - bin.top)}%`,
          width: `${bin.width}%`,
        }"
        :title="`${fmt(bin.lower)} - ${fmt(bin.upper)} · ${bin.label}`"
      >
        <span v-if="bin.weight > 0.08">{{ bin.label }}</span>
      </div>

      <div
        v-for="m in markers"
        :key="m.label"
        :class="['lf-line', `tone-${m.tone}`]"
        :style="{ top: `${m.y}%` }"
      >
        <b>{{ m.label }}</b>
        <span>{{ fmt(m.price) }}</span>
      </div>

      <div
        v-for="order in orderTicks"
        :key="`${order.side}-${order.price}-${order.role}`"
        :class="['lf-order', order.side]"
        :style="{ top: `${order.y}%`, width: `${order.width}%` }"
        :title="`${order.role} ${order.side === 'buy' ? '买' : '卖'} @ ${fmt(order.price)} · ${fmt(order.notional)}`"
      >
        <span>{{ order.role }}</span>
      </div>
    </div>

    <footer class="lf-foot">
      <div><b>{{ (concentration * 100).toFixed(0) }}%</b><span>峰值权重</span></div>
      <div><b>{{ orderTicks.length }}</b><span>挂单刻度</span></div>
    </footer>
  </aside>
</template>

<style scoped>
.lf-rack {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  min-width: 0;
  border-left: 1px solid var(--line);
  background: var(--surface);
}

.lf-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px 6px;
  border-bottom: 1px solid var(--line);
}

.lf-head div {
  display: grid;
  gap: 1px;
}

.lf-head span {
  color: var(--green);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.06em;
}

.lf-head strong {
  font-size: 0.78rem;
}

.lf-tags {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.lf-tags em {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 1px 6px;
  color: var(--muted);
  font-size: 0.58rem;
  font-style: normal;
  font-weight: 900;
  white-space: nowrap;
}

.lf-scale {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  color: var(--muted);
  font-size: 0.62rem;
  font-variant-numeric: tabular-nums;
  border-bottom: 1px solid var(--line);
}

.lf-board {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(to bottom, transparent 0, transparent calc(25% - 1px), var(--line) 25%, transparent calc(25% + 1px)),
    linear-gradient(to bottom, transparent 0, transparent calc(50% - 1px), var(--line) 50%, transparent calc(50% + 1px)),
    linear-gradient(to bottom, transparent 0, transparent calc(75% - 1px), var(--line) 75%, transparent calc(75% + 1px));
}

.lf-bin {
  position: absolute;
  right: 8px;
  min-height: 4px;
  border-radius: 4px 0 0 4px;
  background: linear-gradient(90deg, rgba(39, 79, 159, 0.28), rgba(14, 117, 88, 0.72));
  border: 1px solid rgba(14, 117, 88, 0.28);
  border-right: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding-left: 4px;
}

.lf-bin span {
  color: #fff;
  font-size: 0.55rem;
  font-weight: 900;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
}

.lf-line {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 4px;
  transform: translateY(-50%);
  border-top: 1px dashed var(--muted);
  padding: 0 5px;
  pointer-events: none;
}

.lf-line b,
.lf-line span {
  background: var(--surface);
  color: var(--muted);
  font-size: 0.55rem;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
}

.lf-line.tone-price {
  border-top-color: var(--ink);
}

.lf-line.tone-price b,
.lf-line.tone-price span {
  color: var(--ink);
}

.lf-line.tone-cost {
  border-top-color: var(--green);
}

.lf-line.tone-cost b,
.lf-line.tone-cost span {
  color: var(--green);
}

.lf-line.tone-band {
  border-top-color: var(--blue);
}

.lf-order {
  position: absolute;
  left: 8px;
  height: 9px;
  min-width: 18px;
  transform: translateY(-50%);
  border-radius: 2px;
  opacity: 0.9;
}

.lf-order.buy {
  background: var(--blue);
}

.lf-order.sell {
  background: var(--red);
}

.lf-order span {
  position: absolute;
  left: 2px;
  top: -12px;
  color: var(--ink);
  font-size: 0.54rem;
  font-weight: 900;
  white-space: nowrap;
}

.lf-foot {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  border-top: 1px solid var(--line);
}

.lf-foot div {
  display: grid;
  gap: 1px;
  padding: 6px 7px;
  background: var(--panel);
}

.lf-foot b {
  color: var(--green);
  font-size: 0.8rem;
}

.lf-foot span {
  color: var(--muted);
  font-size: 0.55rem;
  font-weight: 800;
}
</style>
