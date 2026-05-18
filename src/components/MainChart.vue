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
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChartStatusBar from './ChartStatusBar.vue'
import MainChartHoverLegend from './MainChartHoverLegend.vue'
import { SERIES_META, fallbackValue, groupIndicators } from './mainChartLegendMeta.js'
import { computeKDJ } from '../domain/indicators/kdj.js'
import { computeRSI } from '../domain/indicators/rsi.js'
import { resolveChartOverlayPlan } from '../domain/research-visualization/chartPaneLayout.js'
import { buildChartMarkers } from '../domain/research-visualization/chartMarkers.js'

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  market: { type: Object, default: null },
  decision: { type: Object, default: null },
  overlays: { type: Object, required: true },
  input: { type: Object, required: true },
})

const emit = defineEmits(['cursor-change', 'param-change'])

const el = ref(null)
const hoverIndex = ref(null)
const hoverLegend = ref(null)  // { date, ohlcv, indicators: [{key, title, color, value, unit}] }
let chart = null
let markersApi = null
let themeObserver = null
const series = {}        // 当前已挂载的 series 实例
const seriesMeta = {}    // 每个 series 的展示 metadata（title/color/unit/group）
let resizeObserver = null
let paneLayout = { main: 0 }
let overlayPlan = null
let paneLayoutSignature = ''

onMounted(() => {
  chart = createChart(el.value, chartOptions())
  applyOverlays()
  syncChart()
  chart.subscribeCrosshairMove(handleCrosshair)
  resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(el.value)
  themeObserver = new MutationObserver(() => syncChart())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  chart?.unsubscribeCrosshairMove(handleCrosshair)
  chart?.remove()
})

watch(() => [props.rows, props.costPath, props.formulaPath, props.entryPrice, props.replay, props.decision], () => {
  applyOverlays()
  syncChart()
}, { deep: true })
watch(() => ({ ...props.overlays }), () => {
  applyOverlays()
  syncChart()
}, { deep: true })

function applyOverlays() {
  if (!chart) return
  overlayPlan = resolveChartOverlayPlan({ overlays: props.overlays, formulaPath: props.formulaPath })
  const nextLayout = overlayPlan.panes
  const nextSignature = JSON.stringify(nextLayout)
  if (nextSignature !== paneLayoutSignature) {
    resetOverlaySeries()
    paneLayoutSignature = nextSignature
  }
  paneLayout = nextLayout
  // 蜡烛 + 量始终存在；用 visibility 控制其它项
  ensure('candle', () => chart.addSeries(CandlestickSeries, {
    upColor: '#0e7558', downColor: '#a93226',
    borderVisible: false,
    wickUpColor: '#0e7558', wickDownColor: '#a93226',
    priceLineVisible: false,
  }))
  toggle('cost', overlayPlan.price.costBand, () => addLine('成本锚', '#0e7558', 2))
  toggle('costUpper', overlayPlan.price.costBand, () => addLine('成本上沿', '#8b5a16', 1, LineStyle.Dashed))
  toggle('costLower', overlayPlan.price.costBand, () => addLine('成本下沿', '#274f9f', 1, LineStyle.Dashed))
  toggle('deltaUpper', overlayPlan.price.deltaBand, () => addLine('GetDelta 上沿', '#9a4f00', 1, LineStyle.Dotted))
  toggle('deltaLower', overlayPlan.price.deltaBand, () => addLine('GetDelta 下沿', '#1f5fbf', 1, LineStyle.Dotted))
  toggle('lpLower', overlayPlan.price.lpBand, () => addLine('LP区间下沿', '#7a5cff', 1, LineStyle.Dashed))
  toggle('lpUpper', overlayPlan.price.lpBand, () => addLine('LP区间上沿', '#7a5cff', 1, LineStyle.Dashed))
  toggle('lpRealPrice', overlayPlan.price.lpRealPrice, () => addLine('链上池价', '#8b5a16', 2, LineStyle.Dotted))
  toggle('entry', overlayPlan.price.entryLine, () => addLine('入场', '#b3261e', 1, LineStyle.Dotted))
  toggle('volume', overlayPlan.paneOn.volume, () => chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: '', color: '#b7c1d8',
    priceLineVisible: false, lastValueVisible: true,
  }, paneLayout.volume))
  toggle('regime', overlayPlan.paneOn.volume, () => chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: '',
    priceLineVisible: false, lastValueVisible: false,
  }, paneLayout.volume))
  toggle('bsDelta', overlayPlan.paneOn.greeks, () => addPaneLine('期权 Delta', '#a93226', paneLayout.greeks, { priceScaleId: 'greeks-delta' }))
  toggle('bsGamma', overlayPlan.paneOn.greeks, () => addPaneLine('期权 Gamma', '#8b5a16', paneLayout.greeks, { priceScaleId: 'greeks-gamma' }))
  toggle('bsTheta', overlayPlan.paneOn.greeks, () => addPaneLine('期权 Theta/日', '#274f9f', paneLayout.greeks, { priceScaleId: 'greeks-theta' }))
  toggle('greeksZero', overlayPlan.paneOn.greeks, () => addPaneLine('0', '#888', paneLayout.greeks, { priceScaleId: 'greeks-delta', lineStyle: LineStyle.Dashed, lastValueVisible: false }))
  toggle('lpDelta', overlayPlan.paneOn.lp, () => addPaneLine('LP库存暴露', '#0e7558', paneLayout.lp, { priceScaleId: 'lp-ratio' }))
  toggle('lpValue', overlayPlan.paneOn.lp, () => addPaneLine('LP库存价值', '#7a5cff', paneLayout.lp, { priceScaleId: 'lp-quote' }))
  toggle('lpRealDiv', overlayPlan.paneOn.lp, () => addPaneLine('链上池价偏离', '#8b5a16', paneLayout.lp, { priceScaleId: 'lp-ratio' }))
  toggle('lpPoolTurnover', overlayPlan.paneOn.lpPoolCoverage, () => addPaneLine('真实池24h换手', '#b3261e', paneLayout.lp, { priceScaleId: 'lp-ratio', lineStyle: LineStyle.Dotted }))
  toggle('lpPoolConcentration', overlayPlan.paneOn.lpPoolCoverage, () => addPaneLine('主池资金占比', '#274f9f', paneLayout.lp, { priceScaleId: 'lp-ratio', lineStyle: LineStyle.Dotted }))
  toggle('lpCe', overlayPlan.paneOn.lp, () => addPaneLine('资本效率', '#8b5a16', paneLayout.lp, { priceScaleId: 'lp-multiple' }))
  toggle('lpZero', overlayPlan.paneOn.lp, () => addPaneLine('LP暴露零线', '#888', paneLayout.lp, { priceScaleId: 'lp-ratio', lineStyle: LineStyle.Dashed, lastValueVisible: false }))
  toggle('fundingProxy', overlayPlan.paneOn.carry, () => addPaneLine('Funding估算', '#a93226', paneLayout.carry, { priceScaleId: 'carry-return' }))
  toggle('netCarry', overlayPlan.paneOn.carry, () => addPaneLine('净持有收益', '#0e7558', paneLayout.carry, { priceScaleId: 'carry-return' }))
  toggle('carryZero', overlayPlan.paneOn.carry, () => addPaneLine('持有收益零线', '#888', paneLayout.carry, { priceScaleId: 'carry-return', lineStyle: LineStyle.Dashed, lastValueVisible: false }))
  toggle('equity', overlayPlan.paneOn.equity, () => chart.addSeries(LineSeries, {
    title: '回放权益', color: '#1f5fbf', lineWidth: 2,
    priceLineVisible: false, lastValueVisible: true,
    priceFormat: { type: 'price', precision: 0, minMove: 1 },
  }, paneLayout.equity))
  toggle('equityZero', overlayPlan.paneOn.equity, () => chart.addSeries(LineSeries, {
    title: '盈亏=0', color: '#888', lineWidth: 1, lineStyle: LineStyle.Dashed,
    priceLineVisible: false, lastValueVisible: false,
  }, paneLayout.equity))
  toggle('kdjK', overlayPlan.paneOn.kdj, () => chart.addSeries(LineSeries, {
    title: 'K/D均线', color: 'rgba(255, 165, 0, 0.5)', lineWidth: 1,
    priceLineVisible: false, lastValueVisible: false,
  }, paneLayout.kdj))
  toggle('kdjJ', overlayPlan.paneOn.kdj, () => chart.addSeries(LineSeries, {
    title: 'J线', color: '#4e4e4e', lineWidth: 2,
    priceLineVisible: false, lastValueVisible: false,
  }, paneLayout.kdj))
  if (series.kdjJ && !series.kdjJ.__hlinesInstalled) {
    series.kdjJ.__hlinesInstalled = true
    series.kdjJ.createPriceLine({ price: 100, color: 'rgba(255,0,0,0.3)',  lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
    series.kdjJ.createPriceLine({ price: 0,   color: 'rgba(0,167,6,0.3)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
  }
  toggle('rsi', overlayPlan.paneOn.rsi, () => chart.addSeries(LineSeries, {
    title: 'RSI相对强弱', color: '#2e2e2e', lineWidth: 3,
    priceLineVisible: false, lastValueVisible: false,
  }, paneLayout.rsi))
  if (series.rsi && !series.rsi.__hlinesInstalled) {
    series.rsi.__hlinesInstalled = true
    series.rsi.createPriceLine({ price: 100, color: 'rgba(120,123,134,0.5)', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false })
    series.rsi.createPriceLine({ price: 50,  color: 'rgba(0,0,0,0.7)',       lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false })
    series.rsi.createPriceLine({ price: 0,   color: 'rgba(120,123,134,0.5)', lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: false })
  }
  if (!markersApi) markersApi = createSeriesMarkers(series.candle, [])
  rebalancePanes()
  refreshSeriesMeta()
}

function ensure(key, factory) {
  if (!series[key]) series[key] = factory()
}
function toggle(key, on, factory) {
  if (on && !series[key]) {
    series[key] = factory()
  } else if (!on && series[key]) {
    chart.removeSeries(series[key])
    delete series[key]
    delete seriesMeta[key]
  }
}

function refreshSeriesMeta() {
  for (const key of Object.keys(series)) {
    if (key === 'candle' || key === 'volume' || key === 'regime') continue
    if (key.endsWith('Zero')) continue
    if (SERIES_META[key]) seriesMeta[key] = SERIES_META[key]
  }
  // 清掉已经移除的 series 的 meta
  for (const key of Object.keys(seriesMeta)) {
    if (!series[key]) delete seriesMeta[key]
  }
}

function resetOverlaySeries() {
  if (!chart) return
  for (const key of Object.keys(series)) {
    if (key === 'candle') continue
    chart.removeSeries(series[key])
    delete series[key]
  }
}

function rebalancePanes() {
  const panes = chart.panes()
  if (!panes.length) return
  for (let i = 1; i < panes.length; i += 1) panes[i]?.setStretchFactor(0)
  panes[paneLayout.main]?.setStretchFactor(0.54)
  if (paneLayout.volume !== undefined) panes[paneLayout.volume]?.setStretchFactor(0.12)
  if (paneLayout.greeks !== undefined) panes[paneLayout.greeks]?.setStretchFactor(0.12)
  if (paneLayout.lp !== undefined) panes[paneLayout.lp]?.setStretchFactor(0.12)
  if (paneLayout.carry !== undefined) panes[paneLayout.carry]?.setStretchFactor(0.10)
  if (paneLayout.equity !== undefined) panes[paneLayout.equity]?.setStretchFactor(0.06)
  if (paneLayout.kdj !== undefined) panes[paneLayout.kdj]?.setStretchFactor(0.13)
  if (paneLayout.rsi !== undefined) panes[paneLayout.rsi]?.setStretchFactor(0.13)
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
  series.candle.setData(props.rows.map((row) => ({
    time: row.date, open: row.open, high: row.high, low: row.low, close: row.close,
  })))
  if (series.cost)       setLine(series.cost,       pathValues('costAnchor', props.costPath.map((r) => r.anchor)))
  if (series.costUpper)  setLine(series.costUpper,  pathValues('costUpper', props.costPath.map((r) => r.upper)))
  if (series.costLower)  setLine(series.costLower,  pathValues('costLower', props.costPath.map((r) => r.lower)))
  if (series.deltaUpper) setLine(series.deltaUpper, props.formulaPath.map((r) => r.deltaUpper))
  if (series.deltaLower) setLine(series.deltaLower, props.formulaPath.map((r) => r.deltaLower))
  if (series.lpLower)    setLine(series.lpLower,    props.formulaPath.map((r) => r.lpLowerPrice))
  if (series.lpUpper)    setLine(series.lpUpper,    props.formulaPath.map((r) => r.lpUpperPrice))
  if (series.lpRealPrice) setLine(series.lpRealPrice, props.formulaPath.map((r) => r.lpRealPrice))
  if (series.entry)      setLine(series.entry,      props.rows.map(() => props.entryPrice))
  if (series.volume) {
    series.volume.setData(props.rows.map((row) => ({
      time: row.date, value: row.volume,
      color: row.close >= row.open ? 'rgba(14,117,88,0.38)' : 'rgba(169,50,38,0.38)',
    })))
  }
  if (series.regime) {
    series.regime.setData(props.rows.map((row, i) => {
      const cost = props.costPath[i]
      const zone = cost ? regimeColor(row.close, cost) : null
      return zone ? { time: row.date, value: 1, color: zone } : { time: row.date, value: 0 }
    }))
  }
  if (series.bsDelta) setLine(series.bsDelta, props.formulaPath.map((r) => r.optionDelta))
  if (series.bsGamma) setLine(series.bsGamma, props.formulaPath.map((r) => r.optionGamma))
  if (series.bsTheta) setLine(series.bsTheta, props.formulaPath.map((r) => r.optionThetaDaily))
  if (series.greeksZero) setLine(series.greeksZero, props.rows.map(() => 0))
  if (series.lpDelta) setLine(series.lpDelta, props.formulaPath.map((r) => r.lpNormalizedDelta))
  if (series.lpValue) setLine(series.lpValue, props.formulaPath.map((r) => r.lpValue))
  if (series.lpRealDiv) setLine(series.lpRealDiv, props.formulaPath.map((r) => r.lpRealDivergence))
  if (series.lpPoolTurnover) setLatestPoint(series.lpPoolTurnover, props.formulaPath.at(-1)?.lpPoolTurnover24h)
  if (series.lpPoolConcentration) setLatestPoint(series.lpPoolConcentration, props.formulaPath.at(-1)?.lpPoolTopReserveShare)
  if (series.lpCe) setLine(series.lpCe, props.formulaPath.map((r) => r.capitalEfficiency))
  if (series.lpZero) setLine(series.lpZero, props.rows.map(() => 0))
  if (series.fundingProxy) setLine(series.fundingProxy, props.formulaPath.map((r) => r.fundingProxy))
  if (series.netCarry) setLine(series.netCarry, props.formulaPath.map((r) => r.netCarry))
  if (series.carryZero) setLine(series.carryZero, props.rows.map(() => 0))
  if (series.equity) {
    const equityByDate = new Map((props.replay?.equityCurve ?? []).map((p) => [p.date, p.equity]))
    series.equity.setData(props.rows
      .map((row) => ({ time: row.date, value: equityByDate.has(row.date) ? equityByDate.get(row.date) : null }))
      .filter((p) => p.value !== null))
  }
  if (series.equityZero) {
    series.equityZero.setData(props.rows.map((row) => ({ time: row.date, value: 0 })))
  }
  if (series.kdjK || series.kdjJ) {
    const kdj = computeKDJ(props.rows)
    if (series.kdjK) {
      series.kdjK.setData(kdj
        .map((r) => ({ time: r.date, value: r.k !== null && r.d !== null ? (r.k + r.d) / 2 : null }))
        .filter((p) => p.value !== null))
    }
    if (series.kdjJ) {
      series.kdjJ.setData(kdj
        .map((r) => ({ time: r.date, value: finiteOrNull(r.j) }))
        .filter((p) => p.value !== null))
    }
  }
  if (series.rsi) {
    const rsi = computeRSI(props.rows)
    series.rsi.setData(rsi
      .map((r) => ({ time: r.date, value: finiteOrNull(r.custom) }))
      .filter((p) => p.value !== null))
  }
  // markers：replay trades + 当前决策点 + 研究层状态（domain helper）
  if (markersApi) {
    markersApi.setMarkers(buildChartMarkers({
      rows: props.rows,
      replay: props.replay,
      decision: props.decision,
      overlays: props.overlays,
      formulaPath: props.formulaPath,
    }))
  }
  chart.timeScale().fitContent()
}

function addLine(title, color, width, style = LineStyle.Solid) {
  return chart.addSeries(LineSeries, {
    title, color, lineWidth: width, lineStyle: style,
    priceLineVisible: false, lastValueVisible: true,
  })
}

function addPaneLine(title, color, paneIndex, options = {}) {
  const line = chart.addSeries(LineSeries, deltaLine(title, color, options), paneIndex)
  line.priceScale().applyOptions({
    scaleMargins: { top: 0.18, bottom: 0.18 },
    alignLabels: true,
  })
  return line
}

function deltaLine(title, color, options = {}) {
  return {
    title,
    color,
    lineWidth: options.lineWidth ?? 1,
    lineStyle: options.lineStyle ?? LineStyle.Solid,
    priceScaleId: options.priceScaleId,
    priceLineVisible: false,
    lastValueVisible: options.lastValueVisible ?? true,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  }
}

function setLine(lineSeries, values) {
  lineSeries.setData(props.rows.map((row, i) => ({
    time: row.date, value: finiteOrNull(values[i]),
  })).filter((p) => p.value !== null))
}

function setLatestPoint(lineSeries, value) {
  const last = props.rows.at(-1)
  const next = finiteOrNull(value)
  lineSeries.setData(last && next !== null ? [{ time: last.date, value: next }] : [])
}

function pathValues(field, fallback = []) {
  const values = props.formulaPath.map((row) => row?.[field])
  return values.some(Number.isFinite) ? values : fallback
}

function handleCrosshair(param) {
  if (!param?.time) {
    hoverIndex.value = null
    hoverLegend.value = null
    return
  }
  const idx = props.rows.findIndex((r) => r.date === param.time)
  hoverIndex.value = idx >= 0 ? idx : null
  hoverLegend.value = idx >= 0 ? buildLegend(idx, param) : null
  emit('cursor-change', hoverIndex.value)
}

function buildLegend(idx, param) {
  const row = props.rows[idx]
  if (!row) return null
  const prev = idx > 0 ? props.rows[idx - 1] : null
  const change = Number.isFinite(prev?.close) && Number.isFinite(row.close) ? row.close - prev.close : null
  const changePct = Number.isFinite(change) && prev?.close ? change / prev.close : null
  const direction = !Number.isFinite(change) ? 'flat' : change > 0 ? 'up' : change < 0 ? 'down' : 'flat'

  const indicators = []
  // 优先取 lightweight-charts 提供的 seriesData（hover 那一刻的真实绘制点）
  for (const [key, meta] of Object.entries(seriesMeta)) {
    const s = series[key]
    if (!s) continue
    let value = null
    if (param?.seriesData) {
      const d = param.seriesData.get(s)
      if (d) value = typeof d.value === 'number' ? d.value : (typeof d.close === 'number' ? d.close : null)
    }
    // 兜底：从 props 数组按 idx 取
    if (value === null) value = fallbackValue(key, idx, props.formulaPath, props.costPath, props.entryPrice)
    if (!Number.isFinite(value)) continue
    indicators.push({ key, ...meta, value })
  }

  return {
    date: row.date,
    ohlcv: {
      open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume,
      change, changePct, direction,
    },
    indicators: groupIndicators(indicators),
  }
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

function regimeColor(close, cost) {
  if (!Number.isFinite(close) || !Number.isFinite(cost?.upper) || !Number.isFinite(cost?.lower)) return null
  if (close > cost.upper) return 'rgba(169,50,38,0.45)'
  if (close < cost.lower) return 'rgba(39,79,159,0.45)'
  return 'rgba(14,117,88,0.35)'
}

function finiteOrNull(value) { return Number.isFinite(value) ? value : null }
</script>

<template>
  <div class="main-chart-shell">
    <div ref="el" class="main-chart-canvas" />

    <!-- Hover 图例：拆到子组件，本文件只构造 hoverLegend 对象 -->
    <MainChartHoverLegend :legend="hoverLegend" />

    <ChartStatusBar :input="input" @change="(field, v) => emit('param-change', field, v)" />
  </div>
</template>

<style>
.main-chart-shell { position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.main-chart-canvas { width: 100%; height: 100%; }
</style>
