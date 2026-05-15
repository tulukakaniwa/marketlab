<script setup>
import { computed } from 'vue'
import { buildLiquidityRackModel } from '../domain/market/liquidityRack.js'

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  graph: { type: Object, required: true },
  activeIndex: { type: Number, required: true },
})

const model = computed(() => buildLiquidityRackModel({
  rows: props.rows,
  costPath: props.costPath,
  formulaPath: props.formulaPath,
  graph: props.graph,
  activeIndex: props.activeIndex,
}))

const markerRows = computed(() => {
  const rows = model.value.markers
    .map((marker) => ({ ...marker, labelY: marker.y }))
    .sort((a, b) => a.y - b.y)
  let last = -Infinity
  for (const row of rows) {
    row.labelY = Math.max(row.y, last + 7)
    last = row.labelY
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    rows[i].labelY = Math.min(rows[i].labelY, 96 - (rows.length - 1 - i) * 7)
  }
  return rows
})

function fmt(value) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
    : '—'
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(0)}%` : '—'
}
</script>

<template>
  <aside class="lf-rack" aria-label="流动性指纹挂单分布仓">
    <header class="lf-head">
      <div>
        <span>流动性指纹</span>
        <strong>价格仓</strong>
      </div>
      <div class="lf-tags">
        <em>订单流辅助</em>
        <em>研究层</em>
      </div>
    </header>

    <div class="lf-range">
      <span>{{ fmt(model.range.upper) }}</span>
      <b>深度 / 密度 / 挂单</b>
      <span>{{ fmt(model.range.lower) }}</span>
    </div>

    <svg class="lf-depth" viewBox="0 0 220 300" preserveAspectRatio="none" role="img">
      <defs>
        <linearGradient id="lf-bid" x1="1" x2="0" y1="0" y2="0">
          <stop offset="0" stop-color="var(--green)" stop-opacity="0.78" />
          <stop offset="1" stop-color="var(--blue)" stop-opacity="0.08" />
        </linearGradient>
        <linearGradient id="lf-ask" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="var(--red)" stop-opacity="0.68" />
          <stop offset="1" stop-color="var(--blue)" stop-opacity="0.08" />
        </linearGradient>
        <linearGradient id="lf-density" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stop-color="var(--blue)" stop-opacity="0.16" />
          <stop offset="0.5" stop-color="var(--green)" stop-opacity="0.38" />
          <stop offset="1" stop-color="var(--blue)" stop-opacity="0.16" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="220" height="300" class="lf-bg" />
      <g class="lf-grid">
        <line x1="0" x2="220" y1="75" y2="75" />
        <line x1="0" x2="220" y1="150" y2="150" />
        <line x1="0" x2="220" y1="225" y2="225" />
        <line x1="110" x2="110" y1="0" y2="300" />
      </g>

      <g class="lf-density">
        <rect
          v-for="shelf in model.shelves"
          :key="`d-${shelf.lower}`"
          :x="110 - shelf.densityWidth * 0.38"
          :y="shelf.top * 3"
          :width="shelf.densityWidth * 0.76"
          :height="Math.max(2, shelf.height * 3)"
          rx="5"
        />
      </g>

      <g class="lf-depth-bars">
        <rect
          v-for="shelf in model.shelves"
          :key="`b-${shelf.lower}`"
          :class="['lf-shelf', shelf.side]"
          :x="shelf.side === 'bid' ? 110 - shelf.densityWidth * 0.86 : 110"
          :y="shelf.top * 3"
          :width="shelf.densityWidth * 0.86"
          :height="Math.max(2, shelf.height * 3 - 1)"
          rx="4"
        />
      </g>

      <g class="lf-orders">
        <rect
          v-for="order in model.orderTicks"
          :key="`${order.side}-${order.price}-${order.role}`"
          :class="['lf-order', order.side]"
          :x="order.side === 'buy' ? 110 - order.width * 0.82 : 110"
          :y="order.y * 3 - 4"
          :width="order.width * 0.82"
          height="8"
          rx="2"
        />
      </g>

      <g class="lf-markers">
        <g v-for="marker in markerRows" :key="marker.label">
          <line :class="`tone-${marker.tone}`" x1="0" x2="220" :y1="marker.y * 3" :y2="marker.y * 3" />
          <path
            :class="`tone-${marker.tone}`"
            :d="`M3 ${marker.labelY * 3 - 6} H78 L86 ${marker.y * 3} H108`"
          />
          <text class="lf-marker-label" x="6" :y="marker.labelY * 3 - 9">{{ marker.label }}</text>
          <text class="lf-marker-price" x="76" :y="marker.labelY * 3 - 9" text-anchor="end">{{ fmt(marker.price) }}</text>
        </g>
      </g>

      <g class="lf-axis-labels">
        <text x="10" y="14">BID</text>
        <text x="210" y="14" text-anchor="end">ASK</text>
      </g>
    </svg>

    <footer class="lf-foot">
      <div><b>{{ pct(model.stats.peakWeight) }}</b><span>峰值热度</span></div>
      <div><b>{{ pct(model.stats.belowShare) }}</b><span>下方密度</span></div>
      <div><b>{{ model.stats.orderCount }}</b><span>挂单刻度</span></div>
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
  padding: 8px 9px 7px;
  border-bottom: 1px solid var(--line);
}

.lf-head div {
  display: grid;
  gap: 1px;
}

.lf-head span,
.lf-range b {
  color: var(--green);
  font-size: 0.58rem;
  font-weight: 900;
  letter-spacing: 0.05em;
}

.lf-head strong {
  font-size: 0.9rem;
  line-height: 1.05;
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
  font-size: 0.56rem;
  font-style: normal;
  font-weight: 900;
  white-space: nowrap;
}

.lf-range {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 6px;
  align-items: center;
  padding: 5px 8px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.62rem;
  font-variant-numeric: tabular-nums;
}

.lf-range span:last-child {
  text-align: right;
}

.lf-depth {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: block;
}

.lf-bg {
  fill: var(--surface);
}

.lf-grid line {
  stroke: var(--line);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.lf-density rect {
  fill: url(#lf-density);
}

.lf-shelf {
  opacity: 0.68;
}

.lf-shelf.bid {
  fill: url(#lf-bid);
}

.lf-shelf.ask {
  fill: url(#lf-ask);
}

.lf-order.buy {
  fill: var(--blue);
}

.lf-order.sell {
  fill: var(--red);
}

.lf-markers line {
  stroke-width: 1.4;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}

.lf-markers path {
  fill: none;
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.lf-markers .tone-price {
  stroke: var(--ink);
  stroke-dasharray: 3 3;
}

.lf-markers .tone-cost {
  stroke: var(--green);
}

.lf-markers .tone-upper,
.lf-markers .tone-lower {
  stroke: var(--blue);
}

.lf-marker-label,
.lf-marker-price,
.lf-axis-labels text {
  fill: var(--ink);
  font-size: 9px;
  font-weight: 900;
  dominant-baseline: middle;
  paint-order: stroke;
  stroke: var(--surface);
  stroke-width: 3px;
  stroke-linejoin: round;
}

.lf-marker-price {
  font-variant-numeric: tabular-nums;
}

.lf-axis-labels text {
  fill: var(--muted);
  font-size: 8px;
  letter-spacing: 0.08em;
}

.lf-foot {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1px;
  border-top: 1px solid var(--line);
}

.lf-foot div {
  display: grid;
  gap: 1px;
  min-width: 0;
  padding: 6px 7px;
  background: var(--panel);
}

.lf-foot b {
  color: var(--green);
  font-size: 0.82rem;
  line-height: 1;
}

.lf-foot span {
  color: var(--muted);
  font-size: 0.53rem;
  font-weight: 800;
  white-space: nowrap;
}
</style>
