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
import ChartStatusBar from './ChartStatusBar.vue'
import { computeKDJ } from '../domain/indicators/kdj.js'
import { computeRSI } from '../domain/indicators/rsi.js'
import { resolveChartOverlayPlan } from '../domain/research-visualization/chartPaneLayout.js'

const MAX_REPLAY_MARKER_TRADES = 120
const MAX_REPLAY_TEXT_LABELS = 6

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
let chart = null
let markersApi = null
let themeObserver = null
const series = {}        // 当前已挂载的 series 实例
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
  toggle('lpLower', overlayPlan.price.lpBand, () => addLine('LP 下沿', '#7a5cff', 1, LineStyle.Dashed))
  toggle('lpUpper', overlayPlan.price.lpBand, () => addLine('LP 上沿', '#7a5cff', 1, LineStyle.Dashed))
  toggle('entry', overlayPlan.price.entryLine, () => addLine('入场', '#b3261e', 1, LineStyle.Dotted))
  toggle('volume', overlayPlan.paneOn.volume, () => chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: '', color: '#b7c1d8',
    priceLineVisible: false, lastValueVisible: true,
  }, paneLayout.volume))
  toggle('regime', overlayPlan.paneOn.volume, () => chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: '',
    priceLineVisible: false, lastValueVisible: false,
  }, paneLayout.volume))
  toggle('bsDelta', overlayPlan.paneOn.greeks, () => addPaneLine('BS Δ', '#a93226', paneLayout.greeks, { priceScaleId: 'greeks-delta' }))
  toggle('bsGamma', overlayPlan.paneOn.greeks, () => addPaneLine('BS Γ', '#8b5a16', paneLayout.greeks, { priceScaleId: 'greeks-gamma' }))
  toggle('bsTheta', overlayPlan.paneOn.greeks, () => addPaneLine('BS Θ/日', '#274f9f', paneLayout.greeks, { priceScaleId: 'greeks-theta' }))
  toggle('greeksZero', overlayPlan.paneOn.greeks, () => addPaneLine('0', '#888', paneLayout.greeks, { priceScaleId: 'greeks-delta', lineStyle: LineStyle.Dashed, lastValueVisible: false }))
  toggle('lpDelta', overlayPlan.paneOn.lp, () => addPaneLine('LP norm', '#0e7558', paneLayout.lp, { priceScaleId: 'lp-ratio' }))
  toggle('lpValue', overlayPlan.paneOn.lp, () => addPaneLine('LP value', '#7a5cff', paneLayout.lp, { priceScaleId: 'lp-quote' }))
  toggle('lpCe', overlayPlan.paneOn.lp, () => addPaneLine('CE', '#8b5a16', paneLayout.lp, { priceScaleId: 'lp-multiple' }))
  toggle('lpZero', overlayPlan.paneOn.lp, () => addPaneLine('LP 0', '#888', paneLayout.lp, { priceScaleId: 'lp-ratio', lineStyle: LineStyle.Dashed, lastValueVisible: false }))
  toggle('fundingProxy', overlayPlan.paneOn.carry, () => addPaneLine('Funding proxy', '#a93226', paneLayout.carry, { priceScaleId: 'carry-return' }))
  toggle('netCarry', overlayPlan.paneOn.carry, () => addPaneLine('Net carry', '#0e7558', paneLayout.carry, { priceScaleId: 'carry-return' }))
  toggle('carryZero', overlayPlan.paneOn.carry, () => addPaneLine('Carry 0', '#888', paneLayout.carry, { priceScaleId: 'carry-return', lineStyle: LineStyle.Dashed, lastValueVisible: false }))
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
    title: 'KD', color: 'rgba(255, 165, 0, 0.5)', lineWidth: 1,
    priceLineVisible: false, lastValueVisible: false,
  }, paneLayout.kdj))
  toggle('kdjJ', overlayPlan.paneOn.kdj, () => chart.addSeries(LineSeries, {
    title: 'J', color: '#4e4e4e', lineWidth: 2,
    priceLineVisible: false, lastValueVisible: false,
  }, paneLayout.kdj))
  if (series.kdjJ && !series.kdjJ.__hlinesInstalled) {
    series.kdjJ.__hlinesInstalled = true
    series.kdjJ.createPriceLine({ price: 100, color: 'rgba(255,0,0,0.3)',  lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
    series.kdjJ.createPriceLine({ price: 0,   color: 'rgba(0,167,6,0.3)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
  }
  toggle('rsi', overlayPlan.paneOn.rsi, () => chart.addSeries(LineSeries, {
    title: 'RSI', color: '#2e2e2e', lineWidth: 3,
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
  // markers：replay trades + 当前状态点
  if (markersApi) markersApi.setMarkers(buildMarkers())
  chart.timeScale().fitContent()
}

function buildMarkers() {
  const out = []
  if (overlayOn('executionMarkers') && props.overlays.replayMarkers) {
    out.push(...buildReplayMarkers(props.replay?.trades ?? []))
  }
  if (overlayOn('executionMarkers') && props.overlays.currentDecision && props.rows.length && props.decision) {
    const last = props.rows.at(-1)
    const side = props.decision.timing?.side
    out.push({
      time: last.date,
      position: side === 'sell' ? 'aboveBar' : 'belowBar',
      shape: side === 'buy' ? 'arrowUp' : side === 'sell' ? 'arrowDown' : 'circle',
      color: side === 'buy' ? '#0e7558' : side === 'sell' ? '#a93226' : '#888',
      text: props.decision.state || '',
      id: 'current-decision',
    })
  }
  if (overlayOn('researchMarkers')) out.push(...buildResearchMarkers())
  return out.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
}

function buildResearchMarkers() {
  const last = props.formulaPath.at(-1)
  if (!last?.date || !Array.isArray(last.status) || !last.status.length) return []
  const flagged = Object.values(last.fieldStates ?? {})
    .filter((state) => state?.status !== 'implemented' || state?.missingInputs?.length || state?.isSynthetic)
  const label = compactResearchLabel(last.status, flagged)
  return [{
    time: last.date,
    position: 'aboveBar',
    shape: 'circle',
    color: '#7a5cff',
    text: label,
    id: 'research-status',
  }]
}

function compactResearchLabel(statuses, flagged) {
  const parts = []
  if (statuses.includes('research-only')) parts.push('研究')
  if (statuses.includes('proxy-only')) parts.push('代理')
  if (statuses.includes('protocol-unverified')) parts.push('未验')
  if (statuses.includes('missing-input')) parts.push('缺输入')
  if (!parts.length && flagged.length) parts.push('状态')
  return parts.slice(0, 3).join(' · ')
}

function buildReplayMarkers(trades) {
  const start = Math.max(0, trades.length - MAX_REPLAY_MARKER_TRADES)
  const visibleTrades = trades.slice(start)
  const showTextFrom = props.overlays.replayMarkerLabels
    ? Math.max(0, visibleTrades.length - MAX_REPLAY_TEXT_LABELS)
    : Infinity
  return visibleTrades.flatMap((trade, localIndex) => {
    const i = start + localIndex
    const isBuy = trade.side === 'buy'
    const showText = localIndex >= showTextFrom
    const markers = []
    if (trade.signalDate && trade.signalDate !== trade.fillDate) {
      markers.push(withMarkerText({
        time: trade.signalDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: 'circle',
        color: isBuy ? '#0e7558' : '#a93226',
        id: `signal-${i}`,
      }, showText, `${isBuy ? '买入' : '卖出'}信号`))
    }
    if (trade.fillDate === trade.exitDate) {
      markers.push(withMarkerText({
        time: trade.fillDate,
        position: isBuy ? 'belowBar' : 'aboveBar',
        shape: isBuy ? 'arrowUp' : 'arrowDown',
        color: isBuy ? '#0e7558' : '#a93226',
        id: `fill-${i}`,
      }, showText, `${trade.reason} ${isBuy ? '成交 @' + money(trade.fillPrice) : signedMoney(trade.pnl)}`))
      return markers
    }
    markers.push(
      withMarkerText({ time: trade.fillDate, position: isBuy ? 'belowBar' : 'aboveBar', shape: isBuy ? 'arrowUp' : 'arrowDown', color: isBuy ? '#0e7558' : '#a93226', id: `fill-${i}` }, showText, `${isBuy ? '买入' : '卖出'}成交 ${money(trade.fillPrice)}`),
      withMarkerText({ time: trade.exitDate, position: trade.pnl >= 0 ? 'aboveBar' : 'belowBar', shape: 'circle', color: trade.pnl >= 0 ? '#0e7558' : '#a93226', id: `exit-${i}` }, showText, `${trade.reason} ${signedMoney(trade.pnl)}`),
    )
    return markers
  })
}

function withMarkerText(marker, show, text) {
  return show ? { ...marker, text } : marker
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

function overlayOn(key) {
  return props.overlays[key] !== false
}

function setLine(lineSeries, values) {
  lineSeries.setData(props.rows.map((row, i) => ({
    time: row.date, value: finiteOrNull(values[i]),
  })).filter((p) => p.value !== null))
}

function pathValues(field, fallback = []) {
  const values = props.formulaPath.map((row) => row?.[field])
  return values.some(Number.isFinite) ? values : fallback
}

function handleCrosshair(param) {
  if (!param?.time) {
    hoverIndex.value = null
    return
  }
  const idx = props.rows.findIndex((r) => r.date === param.time)
  hoverIndex.value = idx >= 0 ? idx : null
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

function regimeColor(close, cost) {
  if (!Number.isFinite(close) || !Number.isFinite(cost?.upper) || !Number.isFinite(cost?.lower)) return null
  if (close > cost.upper) return 'rgba(169,50,38,0.45)'
  if (close < cost.lower) return 'rgba(39,79,159,0.45)'
  return 'rgba(14,117,88,0.35)'
}

function finiteOrNull(value) { return Number.isFinite(value) ? value : null }
function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '无' }
function signedMoney(v) { return Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${money(v)}` : '无' }
</script>

<template>
  <div class="main-chart-shell">
    <div ref="el" class="main-chart-canvas" />
    <ChartStatusBar :input="input" @change="(field, v) => emit('param-change', field, v)" />
  </div>
</template>

<style>
.main-chart-shell { position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden; }
.main-chart-canvas { width: 100%; height: 100%; }
</style>
