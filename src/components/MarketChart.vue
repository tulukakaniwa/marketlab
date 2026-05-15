<script setup>
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from 'lightweight-charts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formulaStages } from '../domain/formulas/registry.js'
import LiquidityFingerprintRack from './LiquidityFingerprintRack.vue'

const stageNames = Object.fromEntries(formulaStages.map(s => [s.id, s.label]))

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  entryPrice: { type: Number, required: true },
  graph: { type: Object, required: true },
  replay: { type: Object, required: true },
})

const emit = defineEmits(['cursor-change'])

const el = ref(null)
const hoverIndex = ref(null)
let chart = null
let markersApi = null
let themeObserver = null
const series = {}
const resizeObserver = new ResizeObserver(() => resize())

const activeIndex = computed(() => hoverIndex.value ?? Math.max(0, props.rows.length - 1))
const activeRow = computed(() => props.rows[activeIndex.value])
const activeCost = computed(() => props.costPath[activeIndex.value])
const activeFormula = computed(() => props.formulaPath[activeIndex.value])
const activeRegime = computed(() => regimeFor(activeRow.value, activeCost.value))
const regimeCounts = computed(() => countRegimes(props.rows, props.costPath))

onMounted(() => {
  chart = createChart(el.value, chartOptions())
  createSeries()
  syncChart()
  chart.subscribeCrosshairMove(handleCrosshair)
  resizeObserver.observe(el.value)
  themeObserver = new MutationObserver(() => syncChart())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  resizeObserver.disconnect()
  themeObserver?.disconnect()
  chart?.unsubscribeCrosshairMove(handleCrosshair)
  chart?.remove()
})

watch(() => [props.rows, props.costPath, props.formulaPath, props.entryPrice, props.replay], syncChart, { deep: true })

function createSeries() {
  series.candle = chart.addSeries(CandlestickSeries, {
    upColor: '#0e7558',
    downColor: '#a93226',
    borderVisible: false,
    wickUpColor: '#0e7558',
    wickDownColor: '#a93226',
    priceLineVisible: false,
  })
  series.cost = addLine(stageNames.cost || '成本锚', '#0e7558', 2)
  series.costUpper = addLine((stageNames.cost || '成本') + '上沿', '#8b5a16', 1, LineStyle.Dashed)
  series.costLower = addLine((stageNames.cost || '成本') + '下沿', '#274f9f', 1, LineStyle.Dashed)
  series.deltaUpper = addLine((stageNames['delta-band'] || '波动带') + '上沿', '#9a4f00', 1, LineStyle.Dotted)
  series.deltaLower = addLine((stageNames['delta-band'] || '波动带') + '下沿', '#1f5fbf', 1, LineStyle.Dotted)
  series.entry = addLine('入场', '#b3261e', 1, LineStyle.Dotted)
  series.volume = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: '',
    color: '#b7c1d8',
  }, 1)
  series.regime = chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' },
    priceScaleId: '',
  }, 1)
  series.bsDelta = chart.addSeries(LineSeries, deltaLine(stageNames['option-greeks'] + ' Δ', '#a93226'), 2)
  series.lpDelta = chart.addSeries(LineSeries, deltaLine(stageNames['lp-inventory'] + ' Δ', '#0e7558'), 2)
  series.zero = chart.addSeries(LineSeries, deltaLine('Δ=0', '#888', LineStyle.Dashed), 2)
  // pane 3：回放权益曲线（与 K 线时间轴对齐，可视化看到决策的累计盈亏）
  series.equity = chart.addSeries(LineSeries, {
    title: '回放权益',
    color: '#1f5fbf',
    lineWidth: 2,
    priceLineVisible: false,
    lastValueVisible: true,
    priceFormat: { type: 'price', precision: 0, minMove: 1 },
  }, 3)
  series.equityZero = chart.addSeries(LineSeries, {
    title: '盈亏=0',
    color: '#888',
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    priceLineVisible: false,
    lastValueVisible: false,
  }, 3)
  markersApi = createSeriesMarkers(series.candle, [])
  chart.panes()[0]?.setStretchFactor(0.62)
  chart.panes()[1]?.setStretchFactor(0.08)
  chart.panes()[2]?.setStretchFactor(0.18)
  chart.panes()[3]?.setStretchFactor(0.12)
}

function syncChart() {
  if (!chart || !series.candle) return
  const dark = document.documentElement.classList.contains('dark')
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: dark ? '#22241f' : '#fbfaf4' },
      textColor: dark ? '#96958b' : '#57554d',
    },
    grid: {
      vertLines: { color: dark ? 'rgba(61,60,52,0.45)' : 'rgba(215,209,194,0.45)' },
      horzLines: { color: dark ? 'rgba(61,60,52,0.72)' : 'rgba(215,209,194,0.72)' },
    },
    rightPriceScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2' },
    timeScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2' },
  })
  const candleData = props.rows.map((row) => ({
    time: row.date,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
  }))
  series.candle.setData(candleData)
  setLine(series.cost, props.costPath.map((row) => row.anchor))
  setLine(series.costUpper, props.costPath.map((row) => row.upper))
  setLine(series.costLower, props.costPath.map((row) => row.lower))
  setLine(series.deltaUpper, props.formulaPath.map((row) => row.deltaUpper))
  setLine(series.deltaLower, props.formulaPath.map((row) => row.deltaLower))
  setLine(series.entry, props.rows.map(() => props.entryPrice))
  series.volume.setData(props.rows.map((row) => ({
    time: row.date,
    value: row.volume,
    color: row.close >= row.open ? 'rgba(14,117,88,0.38)' : 'rgba(169,50,38,0.38)',
  })))
  series.regime.setData(props.rows.map((row, index) => {
    const cost = props.costPath[index]
    const zone = cost ? regimeColor(row.close, cost) : null
    return zone ? { time: row.date, value: 1, color: zone } : { time: row.date, value: 0 }
  }))
  setLine(series.bsDelta, props.formulaPath.map((row) => row.optionDelta))
  setLine(series.lpDelta, props.formulaPath.map((row) => row.lpInventoryDelta))
  setLine(series.zero, props.rows.map(() => 0))
  // 权益曲线：把 replay.equityCurve 按 date 对齐到 rows
  const equityByDate = new Map((props.replay?.equityCurve ?? []).map((p) => [p.date, p.equity]))
  series.equity.setData(props.rows
    .map((row) => ({ time: row.date, value: equityByDate.has(row.date) ? equityByDate.get(row.date) : null }))
    .filter((p) => p.value !== null)
  )
  series.equityZero.setData(props.rows.map((row) => ({ time: row.date, value: 0 })))
  markersApi?.setMarkers(buildMarkers(props.replay?.trades ?? []))
  chart.timeScale().fitContent()
}

function addLine(title, color, width, style = LineStyle.Solid) {
  return chart.addSeries(LineSeries, {
    title,
    color,
    lineWidth: width,
    lineStyle: style,
    priceLineVisible: false,
    lastValueVisible: true,
  })
}

function deltaLine(title, color, style = LineStyle.Solid) {
  return {
    title,
    color,
    lineWidth: 1,
    lineStyle: style,
    priceLineVisible: false,
    lastValueVisible: false,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  }
}

function setLine(lineSeries, values) {
  lineSeries.setData(props.rows.map((row, index) => ({
    time: row.date,
    value: finiteOrNull(values[index]),
  })).filter((point) => point.value !== null))
}

function buildMarkers(trades) {
  return trades.flatMap((trade, index) => {
    const isBuy = trade.side === 'buy'
    if (trade.fillDate === trade.exitDate) {
      return [{
        time: trade.fillDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#0e7558' : '#a93226',
        text: `${trade.reason} ${isBuy ? '@' + money(trade.fillPrice) : signedMoney(trade.pnl)}`,
        id: `event-${index}`,
      }]
    }
    return [
      {
        time: trade.fillDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#0e7558' : '#a93226',
        text: `${isBuy ? '+' : '-'} ${money(trade.fillPrice)}`,
        id: `fill-${index}`,
      },
      {
        time: trade.exitDate,
        position: trade.pnl >= 0 ? 'aboveBar' : 'belowBar',
        shape: 'circle',
        color: trade.pnl >= 0 ? '#0e7558' : '#a93226',
        text: `${trade.reason} ${signedMoney(trade.pnl)}`,
        id: `exit-${index}`,
      },
    ]
  })
}

function handleCrosshair(param) {
  if (!param?.time) {
    hoverIndex.value = null
    return
  }
  const index = props.rows.findIndex((row) => row.date === param.time)
  hoverIndex.value = index >= 0 ? index : null
  emit('cursor-change', hoverIndex.value)
}

function resize() {
  if (!chart || !el.value) return
  chart.resize(el.value.clientWidth, el.value.clientHeight)
}

function chartOptions() {
  const dark = document.documentElement.classList.contains('dark')
  return {
    autoSize: false,
    layout: {
      background: { type: ColorType.Solid, color: dark ? '#22241f' : '#fbfaf4' },
      textColor: dark ? '#96958b' : '#57554d',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    grid: {
      vertLines: { color: dark ? 'rgba(61,60,52,0.45)' : 'rgba(215,209,194,0.45)' },
      horzLines: { color: dark ? 'rgba(61,60,52,0.72)' : 'rgba(215,209,194,0.72)' },
    },
    crosshair: { mode: CrosshairMode.Normal },
    width: el.value?.clientWidth ?? 800,
    height: el.value?.clientHeight ?? 620,
    rightPriceScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2', scaleMargins: { top: 0.08, bottom: 0.12 } },
    timeScale: { borderColor: dark ? '#3d3c34' : '#d7d1c2', rightOffset: 8, barSpacing: 7 },
  }
}

function regimeFor(row, cost) {
  if (!row || !Number.isFinite(cost?.anchor)) return { label: '等待路径', tone: 'neutral', detail: '载入 K 线后判断' }
  const dist = cost.anchor > 0 ? (row.close - cost.anchor) / cost.anchor : 0
  const pct = (dist * 100).toFixed(1)
  if (row.close > cost.upper) return { label: `溢价 ${pct}%`, tone: 'sell', detail: `价格 ${Math.round(row.close).toLocaleString()} > 成本带上沿 ${Math.round(cost.upper).toLocaleString()}` }
  if (row.close < cost.lower) return { label: `折价 ${pct}%`, tone: 'buy', detail: `价格 ${Math.round(row.close).toLocaleString()} < 成本带下沿 ${Math.round(cost.lower).toLocaleString()}` }
  return { label: `回归 ${pct}%`, tone: 'hold', detail: `价格在成本带 [${Math.round(cost.lower).toLocaleString()}, ${Math.round(cost.upper).toLocaleString()}] 内` }
}

function countRegimes(rows, costs) {
  return rows.reduce((acc, row, index) => {
    const regime = regimeFor(row, costs[index])
    acc[regime.tone] = (acc[regime.tone] ?? 0) + 1
    return acc
  }, { buy: 0, sell: 0, hold: 0 })
}

function regimeColor(close, cost) {
  if (!Number.isFinite(close) || !Number.isFinite(cost?.upper) || !Number.isFinite(cost?.lower)) return null
  if (close > cost.upper) return 'rgba(169,50,38,0.45)'
  if (close < cost.lower) return 'rgba(39,79,159,0.45)'
  return 'rgba(14,117,88,0.35)'
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function money(value) {
  if (!Number.isFinite(value)) return '无'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function signedMoney(value) {
  if (!Number.isFinite(value)) return '无'
  return `${value >= 0 ? '+' : ''}${money(value)}`
}
</script>

<template>
  <div class="trading-chart-shell">
    <div class="chart-state-strip">
      <article :class="['state-chip', activeRegime.tone]">
        <span>当前区间</span>
        <strong>{{ activeRegime.label }}</strong>
        <small>{{ activeRegime.detail }}</small>
      </article>
      <article>
        <span>{{ activeRow?.date ?? '无日期' }}</span>
        <strong>{{ money(activeRow?.close) }}</strong>
        <small>成本 {{ money(activeCost?.anchor) }} / 波动带 {{ money(activeFormula?.deltaLower) }} - {{ money(activeFormula?.deltaUpper) }}</small>
      </article>
      <article>
        <span>路径分布</span>
        <strong>{{ regimeCounts.buy }} / {{ regimeCounts.hold }} / {{ regimeCounts.sell }}</strong>
        <small>折价 / 回归 / 溢价，随光标查看每根 K 的判断</small>
      </article>
    </div>
    <div class="chart-main-row">
      <div ref="el" class="market-chart" />
      <LiquidityFingerprintRack
        :rows="rows"
        :cost-path="costPath"
        :formula-path="formulaPath"
        :graph="graph"
        :active-index="activeIndex"
      />
    </div>
  </div>
</template>
