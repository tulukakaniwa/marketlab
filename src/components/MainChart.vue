<script setup>
import { createChart } from 'lightweight-charts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChartStatusBar from './ChartStatusBar.vue'
import ChartDisplayTools from './ChartDisplayTools.vue'
import ChartDrawingToolbar from './ChartDrawingToolbar.vue'
import MainChartHoverLegend from './MainChartHoverLegend.vue'
import StockChipProfileOverlay from './StockChipProfileOverlay.vue'
import WorkbenchSummary from './WorkbenchSummary.vue'
import { latestFinitePathPoint, resolvePreferredPathValues } from './mainChartLegendMeta.js'
import { computeKDJ } from '../domain/indicators/kdj.js'
import { computeRSI } from '../domain/indicators/rsi.js'
import { buildChartMarkers } from '../domain/research-visualization/chartMarkers.js'
import { useStockChipViewport } from '../composables/useStockChipViewport.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'
import {
  buildChartOptions,
  chartInteractionOptions,
  finiteOrNull,
  mainPriceScaleOptions,
  regimeColor,
  themeOptions,
} from '../composables/mainChartTheme.js'
import { ChartDrawingsPrimitive } from '../composables/ChartDrawingsPrimitive.js'
import { useChartDrawings } from '../composables/useChartDrawings.js'
import { useMainChartLegend } from '../composables/useMainChartLegend.js'
import { useMainChartSeries } from '../composables/useMainChartSeries.js'

const { isMobile } = useBreakpoint()

const props = defineProps({
  rows: { type: Array, required: true },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  market: { type: Object, default: null },
  decision: { type: Object, default: null },
  position: { type: Object, default: null },
  summary: { type: Object, default: null },
  drawingScope: { type: String, default: '' },
  overlays: { type: Object, required: true },
  input: { type: Object, required: true },
})

const emit = defineEmits(['cursor-change', 'param-change', 'set-overlay'])

const el = ref(null)
const drawingLayer = ref(null)
const showStockChipProfile = computed(() => props.overlays.stockChipProfile !== false && !isMobile.value)
let chart = null
let drawingsPrimitive = null
let themeObserver = null
let resizeObserver = null
let fittedDataSignature = ''
let fittedRows = null
let fittedScope = ''

const chartSeries = useMainChartSeries({
  getChart: () => chart,
  getProps: () => props,
})
const { series, seriesMeta, applyOverlays, getPaneLayout, getMarkersApi } = chartSeries
const drawing = useChartDrawings({
  getChart: () => chart,
  getSeries: () => series,
  getPrimitive: () => drawingsPrimitive,
  getScope: () => props.drawingScope,
  getLayer: () => drawingLayer.value,
})
const {
  tool: drawingTool,
  drawings: chartDrawingItems,
  canUndo: canUndoDrawing,
  canRedo: canRedoDrawing,
  canDelete: canDeleteDrawing,
  inputActive: drawingInputActive,
  helpText: drawingHelpText,
} = drawing

const stockChipViewport = useStockChipViewport({
  getChart: () => chart,
  getSeries: () => series,
  getRows: () => props.rows,
  getPaneIndex: () => getPaneLayout().main,
  isEnabled: () => showStockChipProfile.value,
})
const { hoverLegend, handleCrosshair: handleCrosshairBase } = useMainChartLegend({
  getRows: () => props.rows,
  getSeries: () => series,
  getSeriesMeta: () => seriesMeta,
  getProps: () => props,
})

onMounted(() => {
  chart = createChart(el.value, chartOptions())
  applyOverlays()
  drawingsPrimitive = new ChartDrawingsPrimitive()
  series.candle.attachPrimitive(drawingsPrimitive)
  drawing.attach()
  syncChart()
  chart.subscribeCrosshairMove(handleCrosshair)
  chart.timeScale().subscribeVisibleLogicalRangeChange(stockChipViewport.queue)
  stockChipViewport.startMonitor()
  resizeObserver = new ResizeObserver(() => resize())
  resizeObserver.observe(el.value)
  themeObserver = new MutationObserver(() => syncChart())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  stockChipViewport.dispose()
  drawing.dispose()
  if (drawingsPrimitive && series.candle) series.candle.detachPrimitive(drawingsPrimitive)
  chart?.timeScale().unsubscribeVisibleLogicalRangeChange(stockChipViewport.queue)
  chart?.unsubscribeCrosshairMove(handleCrosshair)
  chart?.remove()
})

watch(
  () => [
    props.rows,
    props.drawingScope,
    props.costPath,
    props.formulaPath,
    props.entryPrice,
    props.replay,
    props.decision,
    props.position,
  ],
  () => {
    applyOverlays()
    syncChart()
  },
  { deep: true },
)
watch(
  () => ({ ...props.overlays }),
  () => {
    applyOverlays()
    syncChart()
  },
  { deep: true },
)
watch(showStockChipProfile, (on) => {
  if (on) {
    stockChipViewport.queue()
    stockChipViewport.startMonitor()
  } else {
    stockChipViewport.stopMonitor()
  }
})
watch(drawingInputActive, () => applyDrawingInteractionMode())

function syncChart() {
  if (!chart || !series.candle) return
  const nextDataSignature = chartDataSignature(props.rows)
  const nextScope = props.drawingScope.trim()
  const shouldFit = props.rows !== fittedRows || nextDataSignature !== fittedDataSignature || nextScope !== fittedScope
  const dark = document.documentElement.classList.contains('dark')
  // 主题相关的 layout/grid/rightPriceScale/timeScale 配置统一从 themeOptions 取
  chart.applyOptions(themeOptions(dark))
  series.candle.priceScale().applyOptions(mainPriceScaleOptions())
  series.candle.setData(
    props.rows.map((row) => ({ time: row.date, open: row.open, high: row.high, low: row.low, close: row.close })),
  )
  if (series.cost)
    setLine(series.cost, resolvePreferredPathValues(props.formulaPath, 'costAnchor', props.costPath, 'anchor'))
  if (series.costUpper)
    setLine(series.costUpper, resolvePreferredPathValues(props.formulaPath, 'costUpper', props.costPath, 'upper'))
  if (series.costLower)
    setLine(series.costLower, resolvePreferredPathValues(props.formulaPath, 'costLower', props.costPath, 'lower'))
  if (series.deltaUpper)
    setLine(
      series.deltaUpper,
      props.formulaPath.map((r) => r.deltaUpper),
    )
  if (series.deltaLower)
    setLine(
      series.deltaLower,
      props.formulaPath.map((r) => r.deltaLower),
    )
  if (series.lpLower)
    setLine(
      series.lpLower,
      props.formulaPath.map((r) => r.lpLowerPrice),
    )
  if (series.lpUpper)
    setLine(
      series.lpUpper,
      props.formulaPath.map((r) => r.lpUpperPrice),
    )
  if (series.lpRealPrice)
    setLine(
      series.lpRealPrice,
      props.formulaPath.map((r) => r.lpRealPrice),
    )
  if (series.entry)
    setLine(
      series.entry,
      props.rows.map(() => props.entryPrice),
    )
  if (series.target)
    setLine(
      series.target,
      props.rows.map(() => props.position?.targetPrice),
    )
  if (series.stop)
    setLine(
      series.stop,
      props.rows.map(() => props.position?.stopPrice),
    )
  if (series.volume) {
    series.volume.setData(
      props.rows.map((row) => ({
        time: row.date,
        value: row.volume,
        color: row.close >= row.open ? 'rgba(14,117,88,0.38)' : 'rgba(169,50,38,0.38)',
      })),
    )
  }
  if (series.regime) {
    series.regime.setData(
      props.rows.map((row, i) => {
        const cost = props.costPath[i]
        const zone = cost ? regimeColor(row.close, cost) : null
        return zone ? { time: row.date, value: 1, color: zone } : { time: row.date, value: 0 }
      }),
    )
  }
  if (series.bsDelta)
    setLine(
      series.bsDelta,
      props.formulaPath.map((r) => r.optionDelta),
    )
  if (series.bsGamma)
    setLine(
      series.bsGamma,
      props.formulaPath.map((r) => r.optionGamma),
    )
  if (series.bsTheta)
    setLine(
      series.bsTheta,
      props.formulaPath.map((r) => r.optionThetaPerSession),
    )
  if (series.greeksZero)
    setLine(
      series.greeksZero,
      props.rows.map(() => 0),
    )
  if (series.lpDelta)
    setLine(
      series.lpDelta,
      props.formulaPath.map((r) => r.lpNormalizedDelta),
    )
  if (series.lpValue)
    setLine(
      series.lpValue,
      props.formulaPath.map((r) => r.lpValue),
    )
  if (series.lpRealDiv)
    setLine(
      series.lpRealDiv,
      props.formulaPath.map((r) => r.lpRealDivergence),
    )
  if (series.lpPoolTurnover) setLatestPoint(series.lpPoolTurnover, props.formulaPath, 'lpPoolTurnover24h')
  if (series.lpPoolConcentration) setLatestPoint(series.lpPoolConcentration, props.formulaPath, 'lpPoolTopReserveShare')
  if (series.lpCe)
    setLine(
      series.lpCe,
      props.formulaPath.map((r) => r.capitalEfficiency),
    )
  if (series.lpZero)
    setLine(
      series.lpZero,
      props.rows.map(() => 0),
    )
  if (series.cumulativeFundingProxy)
    setLine(
      series.cumulativeFundingProxy,
      props.formulaPath.map((r) => r.cumulativeFundingProxy),
    )
  if (series.netCarry)
    setLine(
      series.netCarry,
      props.formulaPath.map((r) => r.netCarry),
    )
  if (series.carryZero)
    setLine(
      series.carryZero,
      props.rows.map(() => 0),
    )
  if (series.equity) {
    const equityByDate = new Map((props.replay?.equityCurve ?? []).map((p) => [p.date, p.equity]))
    series.equity.setData(
      props.rows
        .map((row) => ({ time: row.date, value: equityByDate.has(row.date) ? equityByDate.get(row.date) : null }))
        .filter((p) => p.value !== null),
    )
  }
  if (series.equityZero) {
    series.equityZero.setData(props.rows.map((row) => ({ time: row.date, value: 0 })))
  }
  if (series.kdjK || series.kdjJ) {
    const kdj = computeKDJ(props.rows)
    if (series.kdjK) {
      series.kdjK.setData(
        kdj
          .map((r) => ({ time: r.date, value: r.k !== null && r.d !== null ? (r.k + r.d) / 2 : null }))
          .filter((p) => p.value !== null),
      )
    }
    if (series.kdjJ) {
      series.kdjJ.setData(kdj.map((r) => ({ time: r.date, value: finiteOrNull(r.j) })).filter((p) => p.value !== null))
    }
  }
  if (series.rsi) {
    const rsi = computeRSI(props.rows)
    series.rsi.setData(
      rsi.map((r) => ({ time: r.date, value: finiteOrNull(r.custom) })).filter((p) => p.value !== null),
    )
  }
  // markers：replay trades + 当前决策点 + 研究层状态
  const markersApi = getMarkersApi()
  if (markersApi) {
    markersApi.setMarkers(
      buildChartMarkers({
        rows: props.rows,
        replay: props.replay,
        decision: props.decision,
        overlays: props.overlays,
        formulaPath: props.formulaPath,
      }),
    )
  }
  if (shouldFit) {
    chart.timeScale().fitContent()
    fittedRows = props.rows
    fittedDataSignature = nextDataSignature
    fittedScope = nextScope
  }
  drawing.refresh()
  stockChipViewport.queue()
}

function setLine(lineSeries, values) {
  lineSeries.setData(
    props.rows.map((row, i) => ({ time: row.date, value: finiteOrNull(values[i]) })).filter((p) => p.value !== null),
  )
}

function setLatestPoint(lineSeries, path, field) {
  const point = latestFinitePathPoint(props.rows, path, field)
  lineSeries.setData(point ? [point] : [])
}

function handleCrosshair(param) {
  const idx = handleCrosshairBase(param)
  emit('cursor-change', idx)
}

function resize() {
  if (!chart || !el.value) return
  chart.resize(el.value.clientWidth, el.value.clientHeight)
  drawing.refresh()
  stockChipViewport.queue()
}

function resetViewport() {
  chart?.timeScale().fitContent()
  drawing.refresh()
}

function applyDrawingInteractionMode() {
  chart?.applyOptions(chartInteractionOptions(drawingInputActive.value))
  if (drawingInputActive.value) stockChipViewport.stopMonitor()
  else if (showStockChipProfile.value) stockChipViewport.startMonitor()
}

function confirmClearDrawings() {
  if (!chartDrawingItems.value.length) return
  if (window.confirm('清空当前标的的全部手绘标注？清空后仍可撤销。')) drawing.clearDrawings()
}

function chartOptions() {
  const dark = document.documentElement.classList.contains('dark')
  return buildChartOptions({
    dark,
    width: el.value?.clientWidth ?? 800,
    height: el.value?.clientHeight ?? 620,
  })
}

function chartDataSignature(rows) {
  if (!rows.length) return ''
  return `${rows[0]?.date ?? ''}|${rows.at(-1)?.date ?? ''}|${rows.length}`
}
</script>

<template>
  <div class="main-chart-shell">
    <div class="main-chart-chrome">
      <div class="chart-context-rail">
        <WorkbenchSummary :model="summary" compact />
        <slot name="engine-switch" />
      </div>
      <div class="chart-control-deck">
        <ChartDrawingToolbar
          :tool="drawingTool"
          :count="chartDrawingItems.length"
          :can-undo="canUndoDrawing"
          :can-redo="canRedoDrawing"
          :can-delete="canDeleteDrawing"
          :help-text="drawingHelpText"
          @set-tool="drawing.setTool"
          @undo="drawing.undo"
          @redo="drawing.redo"
          @delete="drawing.deleteSelected"
          @clear="confirmClearDrawings"
          @fit="resetViewport"
        />
        <ChartDisplayTools
          :overlays="overlays"
          :chip-available="!isMobile"
          @set-overlay="(key, value) => emit('set-overlay', key, value)"
        />
        <ChartStatusBar :input="input" @change="(field, v) => emit('param-change', field, v)" />
      </div>
    </div>
    <div class="main-chart-stage">
      <div ref="el" class="main-chart-canvas" />
      <div
        ref="drawingLayer"
        class="chart-drawing-input"
        :class="{ active: drawingInputActive }"
        :data-tool="drawingTool"
        @pointerdown="drawing.onPointerDown"
        @pointermove="drawing.onPointerMove"
        @pointerup="drawing.onPointerUp"
        @pointercancel="drawing.onPointerCancel"
        @lostpointercapture="drawing.onLostPointerCapture"
      />
      <MainChartHoverLegend :legend="hoverLegend" />
      <StockChipProfileOverlay v-if="showStockChipProfile" :rows="rows" :viewport="stockChipViewport.viewport.value" />
    </div>
  </div>
</template>
