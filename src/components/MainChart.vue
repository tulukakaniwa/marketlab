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

watch(() => [props.rows, props.costPath, props.formulaPath, props.entryPrice, props.replay, props.decision], syncChart, { deep: true })
watch(() => ({ ...props.overlays }), () => {
  applyOverlays()
  syncChart()
}, { deep: true })

function applyOverlays() {
  if (!chart) return
  const o = props.overlays
  // 蜡烛 + 量始终存在；用 visibility 控制其它项
  ensure('candle', () => chart.addSeries(CandlestickSeries, {
    upColor: '#0e7558', downColor: '#a93226',
    borderVisible: false,
    wickUpColor: '#0e7558', wickDownColor: '#a93226',
    priceLineVisible: false,
  }))
  toggle('cost', o.costBand, () => addLine('成本锚', '#0e7558', 2))
  toggle('costUpper', o.costBand, () => addLine('成本上沿', '#8b5a16', 1, LineStyle.Dashed))
  toggle('costLower', o.costBand, () => addLine('成本下沿', '#274f9f', 1, LineStyle.Dashed))
  toggle('deltaUpper', o.volBand, () => addLine('波动带上沿', '#9a4f00', 1, LineStyle.Dotted))
  toggle('deltaLower', o.volBand, () => addLine('波动带下沿', '#1f5fbf', 1, LineStyle.Dotted))
  toggle('entry', o.entryLine, () => addLine('入场', '#b3261e', 1, LineStyle.Dotted))
  toggle('volume', o.volume, () => chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: '', color: '#b7c1d8',
  }, 1))
  toggle('regime', o.volume, () => chart.addSeries(HistogramSeries, {
    priceFormat: { type: 'volume' }, priceScaleId: '',
  }, 1))
  toggle('bsDelta', o.deltaPane, () => chart.addSeries(LineSeries, deltaLine('期权 Δ', '#a93226'), 2))
  toggle('lpDelta', o.deltaPane, () => chart.addSeries(LineSeries, deltaLine('LP Δ', '#0e7558'), 2))
  toggle('zero', o.deltaPane, () => chart.addSeries(LineSeries, deltaLine('Δ=0', '#888', LineStyle.Dashed), 2))
  toggle('equity', o.equityPane, () => chart.addSeries(LineSeries, {
    title: '回放权益', color: '#1f5fbf', lineWidth: 2,
    priceLineVisible: false, lastValueVisible: true,
    priceFormat: { type: 'price', precision: 0, minMove: 1 },
  }, 3))
  toggle('equityZero', o.equityPane, () => chart.addSeries(LineSeries, {
    title: '盈亏=0', color: '#888', lineWidth: 1, lineStyle: LineStyle.Dashed,
    priceLineVisible: false, lastValueVisible: false,
  }, 3))
  toggle('kdjK', o.kdjPane, () => chart.addSeries(LineSeries, {
    title: 'KD', color: 'rgba(255, 165, 0, 0.5)', lineWidth: 1,
    priceLineVisible: false, lastValueVisible: false,
  }, 4))
  toggle('kdjJ', o.kdjPane, () => chart.addSeries(LineSeries, {
    title: 'J', color: '#4e4e4e', lineWidth: 2,
    priceLineVisible: false, lastValueVisible: false,
  }, 4))
  if (series.kdjJ && !series.kdjJ.__hlinesInstalled) {
    series.kdjJ.__hlinesInstalled = true
    series.kdjJ.createPriceLine({ price: 100, color: 'rgba(255,0,0,0.3)',  lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
    series.kdjJ.createPriceLine({ price: 0,   color: 'rgba(0,167,6,0.3)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false })
  }
  toggle('rsi', o.rsiPane, () => chart.addSeries(LineSeries, {
    title: 'RSI', color: '#2e2e2e', lineWidth: 3,
    priceLineVisible: false, lastValueVisible: false,
  }, 5))
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

function rebalancePanes() {
  // pane 0: 主图 / 1: 量 / 2: Δ / 3: 权益 / 4: KDJ / 5: RSI
  // pane 顺序由 addSeries(..., paneIndex) 第三参数决定，固定不变
  const panes = chart.panes()
  if (!panes.length) return
  const o = props.overlays
  panes[0]?.setStretchFactor(0.50)
  if (panes[1]) panes[1].setStretchFactor(o.volume    ? 0.08 : 0)
  if (panes[2]) panes[2].setStretchFactor(o.deltaPane ? 0.10 : 0)
  if (panes[3]) panes[3].setStretchFactor(o.equityPane? 0.06 : 0)
  if (panes[4]) panes[4].setStretchFactor(o.kdjPane   ? 0.13 : 0)
  if (panes[5]) panes[5].setStretchFactor(o.rsiPane   ? 0.13 : 0)
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
  if (series.cost)       setLine(series.cost,       props.costPath.map((r) => r.anchor))
  if (series.costUpper)  setLine(series.costUpper,  props.costPath.map((r) => r.upper))
  if (series.costLower)  setLine(series.costLower,  props.costPath.map((r) => r.lower))
  if (series.deltaUpper) setLine(series.deltaUpper, props.formulaPath.map((r) => r.deltaUpper))
  if (series.deltaLower) setLine(series.deltaLower, props.formulaPath.map((r) => r.deltaLower))
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
  if (series.lpDelta) setLine(series.lpDelta, props.formulaPath.map((r) => r.lpInventoryDelta))
  if (series.zero)    setLine(series.zero,    props.rows.map(() => 0))
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
  // markers：replay trades + 当前决策点
  if (markersApi) markersApi.setMarkers(buildMarkers())
  chart.timeScale().fitContent()
}

function buildMarkers() {
  const out = []
  if (props.overlays.replayMarkers) {
    out.push(...buildReplayMarkers(props.replay?.trades ?? []))
  }
  if (props.overlays.currentDecision && props.rows.length && props.decision) {
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
  return out.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0)
}

function buildReplayMarkers(trades) {
  const showTextFrom = props.overlays.replayMarkerLabels
    ? Math.max(0, trades.length - MAX_REPLAY_TEXT_LABELS)
    : Infinity
  return trades.flatMap((trade, i) => {
    const isBuy = trade.side === 'buy'
    const showText = i >= showTextFrom
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

function deltaLine(title, color, style = LineStyle.Solid) {
  return {
    title, color, lineWidth: 1, lineStyle: style,
    priceLineVisible: false, lastValueVisible: false,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  }
}

function setLine(lineSeries, values) {
  lineSeries.setData(props.rows.map((row, i) => ({
    time: row.date, value: finiteOrNull(values[i]),
  })).filter((p) => p.value !== null))
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
