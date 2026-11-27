<script setup>
import { computed } from 'vue'
import LiquidityDepthLegend from './LiquidityDepthLegend.vue'

const props = defineProps({
  model: { type: Object, required: true },
  variant: { type: String, default: 'compact' },
  precision: { type: Number, default: 2 },
  showTable: { type: Boolean, default: false },
})

const width = 300
const height = 360
const center = width / 2
const bidId = computed(() => `lf-bid-${props.variant}`)
const askId = computed(() => `lf-ask-${props.variant}`)
const densityId = computed(() => `lf-density-${props.variant}`)

const markerRows = computed(() => {
  const spacing = props.variant === 'expanded' ? 5.5 : 8
  const rows = (props.model.markers ?? []).map((marker) => ({ ...marker, labelY: marker.y })).sort((a, b) => a.y - b.y)
  let last = -Infinity
  for (const row of rows) {
    row.labelY = Math.max(row.y, last + spacing)
    last = row.labelY
  }
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    rows[i].labelY = Math.min(rows[i].labelY, 97 - (rows.length - 1 - i) * spacing)
  }
  return rows
})

const tableShelves = computed(() => {
  const shelves = props.model.shelves ?? []
  if (props.showTable) return shelves
  return shelves.filter((shelf) => shelf.intensity > 0.2 || shelf.buyNotional > 0 || shelf.sellNotional > 0)
})
const visibleMarkers = computed(() => (props.variant === 'expanded' ? [] : markerRows.value))

function y(value) {
  return value * (height / 100)
}

function shelfHeight(shelf) {
  return Math.max(1.8, shelf.height * (height / 100) - 0.8)
}

function densityX(shelf) {
  return center - shelf.densityWidth * 0.48
}

function densityWidth(shelf) {
  return shelf.densityWidth * 0.96
}

function signalWidth(shelf) {
  return shelf.realWidth * 0.96
}

function signalX(shelf) {
  return center - shelf.realWidth * 0.48
}

function sideX(shelf) {
  return shelf.side === 'bid' ? center - shelf.densityWidth : center
}

function shelfFill(shelf) {
  const mode = props.model.effectiveViewMode ?? props.model.viewMode
  if (mode === 'gap' && props.model.gapMode === 'signed' && shelf.gapDirection === 'crowded') {
    return 'rgba(139, 90, 22, 0.5)'
  }
  return shelf.side === 'bid' ? `url(#${bidId.value})` : `url(#${askId.value})`
}

function orderX(order) {
  return order.side === 'buy' ? center - order.width : center
}

function componentClass(shelf) {
  return `is-${shelf.dominantComponent || 'base'}`
}

function componentLabel(value) {
  return (
    { base: '底层', active: '现价', cost: '成本', orders: '挂单', range: '区间', real: '链上', gap: '缺口' }[value] ??
    '底层'
  )
}

function fmt(value, digits = props.precision) {
  return Number.isFinite(value)
    ? new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)
    : '-'
}

function pct(value) {
  if (!Number.isFinite(value)) return '-'
  if (value > 0 && value < 0.001) return '<0.1%'
  return `${(value * 100).toFixed(1)}%`
}

function signedPct(value) {
  if (!Number.isFinite(value)) return '-'
  if (Math.abs(value) > 0 && Math.abs(value) < 0.001) return value < 0 ? '-<0.1%' : '+<0.1%'
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

function shareText(shelf) {
  const mode = props.model.effectiveViewMode ?? props.model.viewMode
  if (mode === 'compare') return `${pct(shelf.modelShare)} / ${pct(shelf.realShare)}`
  if (mode === 'real') return pct(shelf.realShare)
  if (mode === 'gap') return props.model.gapMode === 'signed' ? signedPct(shelf.gapShare) : pct(shelf.densityShare)
  return pct(shelf.modelShare)
}

function notional(value) {
  if (!Number.isFinite(value) || Math.abs(value) < 1e-9) return '—'
  return fmt(value)
}
</script>

<template>
  <div :class="['lf-depth-wrap', variant, `mode-${model.effectiveViewMode || model.viewMode || 'compare'}`]">
    <div class="lf-chart-shell">
      <svg class="lf-depth" :viewBox="`0 0 ${width} ${height}`" preserveAspectRatio="xMidYMid meet" role="img">
        <defs>
          <linearGradient :id="bidId" x1="1" x2="0" y1="0" y2="0">
            <stop offset="0" stop-color="var(--green)" stop-opacity="0.82" />
            <stop offset="1" stop-color="var(--blue)" stop-opacity="0.08" />
          </linearGradient>
          <linearGradient :id="askId" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="var(--red)" stop-opacity="0.72" />
            <stop offset="1" stop-color="var(--blue)" stop-opacity="0.08" />
          </linearGradient>
          <linearGradient :id="densityId" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stop-color="var(--blue)" stop-opacity="0.12" />
            <stop offset="0.5" stop-color="var(--green)" stop-opacity="0.34" />
            <stop offset="1" stop-color="var(--blue)" stop-opacity="0.12" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" :width="width" :height="height" class="lf-bg" />
        <g class="lf-grid">
          <line
            v-for="tick in model.ticks"
            :key="`g-${tick.price}`"
            x1="0"
            :x2="width"
            :y1="y(tick.y)"
            :y2="y(tick.y)"
          />
          <line :x1="center" :x2="center" y1="0" :y2="height" />
        </g>

        <g class="lf-density">
          <rect
            v-for="shelf in model.shelves"
            :key="`d-${shelf.lower}`"
            :x="densityX(shelf)"
            :y="y(shelf.top)"
            :width="densityWidth(shelf)"
            :height="shelfHeight(shelf)"
            :fill="`url(#${densityId})`"
            rx="5"
          />
        </g>

        <g
          v-if="model.hasRealSignal && !['simulate', 'gap'].includes(model.effectiveViewMode || model.viewMode)"
          class="lf-real-signal"
        >
          <rect
            v-for="shelf in model.shelves"
            :key="`r-${shelf.lower}`"
            :x="signalX(shelf)"
            :y="y(shelf.top)"
            :width="signalWidth(shelf)"
            :height="shelfHeight(shelf)"
            rx="5"
          />
        </g>

        <g class="lf-depth-bars">
          <rect
            v-for="shelf in model.shelves"
            :key="`b-${shelf.lower}`"
            :class="['lf-shelf', shelf.side]"
            :x="sideX(shelf)"
            :y="y(shelf.top)"
            :width="shelf.densityWidth"
            :height="shelfHeight(shelf)"
            :fill="shelfFill(shelf)"
            rx="4"
          />
        </g>

        <g class="lf-components-track">
          <rect
            v-for="shelf in model.shelves"
            :key="`c-${shelf.lower}`"
            :class="componentClass(shelf)"
            :x="center - 2"
            :y="y(shelf.top)"
            width="4"
            :height="shelfHeight(shelf)"
            rx="1"
          />
        </g>

        <g class="lf-orders">
          <rect
            v-for="order in model.orderTicks"
            :key="`${order.side}-${order.price}-${order.role}`"
            :class="['lf-order', order.side]"
            :x="orderX(order)"
            :y="y(order.y) - 4"
            :width="order.width"
            height="8"
            rx="2"
          />
        </g>

        <g class="lf-markers">
          <g v-for="marker in visibleMarkers" :key="marker.label">
            <line :class="`tone-${marker.tone}`" x1="0" :x2="width" :y1="y(marker.y)" :y2="y(marker.y)" />
            <path
              :class="`tone-${marker.tone}`"
              :d="`M6 ${y(marker.labelY) - 6} H112 L124 ${y(marker.y)} H${center - 4}`"
            />
            <text class="lf-marker-label" x="10" :y="y(marker.labelY) - 9">{{ marker.label }}</text>
            <text class="lf-marker-price" x="110" :y="y(marker.labelY) - 9" text-anchor="end">
              {{ fmt(marker.price) }}
            </text>
          </g>
        </g>

        <g class="lf-axis-labels">
          <text x="12" y="16">下侧</text>
          <text :x="width - 12" y="16" text-anchor="end">上侧</text>
        </g>
        <g class="lf-price-ticks">
          <text
            v-for="tick in model.ticks"
            :key="`t-${tick.price}`"
            :x="width - 8"
            :y="y(tick.y) - 3"
            text-anchor="end"
          >
            {{ fmt(tick.price) }}
          </text>
        </g>
      </svg>

      <LiquidityDepthLegend :model="model" />
    </div>

    <div v-if="showTable" class="lf-table">
      <div :class="['lf-table-head', `mode-${model.effectiveViewMode || model.viewMode || 'compare'}`]">
        <span>价格区间</span>
        <span>{{ model.shareLabel }}</span>
        <span>主成分</span>
        <span>计划挂单</span>
      </div>
      <div
        v-for="shelf in tableShelves"
        :key="`row-${shelf.lower}`"
        :class="['lf-table-row', `mode-${model.effectiveViewMode || model.viewMode || 'compare'}`]"
      >
        <span>{{ fmt(shelf.lower) }} - {{ fmt(shelf.upper) }}</span>
        <span>{{ shareText(shelf) }}</span>
        <span>{{ componentLabel(shelf.dominantComponent) }}</span>
        <span :class="shelf.netNotional >= 0 ? 'green' : 'red'">{{ notional(shelf.netNotional) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped src="../styles/liquidity-rack-depth.css"></style>
