<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ChartStatusBar from './ChartStatusBar.vue'
import ChartDisplayTools from './ChartDisplayTools.vue'
import WorkbenchSummary from './WorkbenchSummary.vue'
import { buildChartMarkers } from '../domain/research-visualization/chartMarkers.js'
import { toVelaTime } from '../infrastructure/charting/velaResearchAdapter.js'
import { createVelaChartAdapter } from '../infrastructure/charting/velaChartAdapter.js'
import { waitForChartOperation } from '../infrastructure/charting/chartOperation.js'
import { useMarketLabChartIndicators } from '../composables/useMarketLabChartIndicators.js'
import { useVelaDrawings } from '../composables/useVelaDrawings.js'
import { useBreakpoint } from '../composables/useBreakpoint.js'

const props = defineProps({
  rows: { type: Array, required: true },
  source: { type: Object, default: null },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  causalPath: { type: Array, default: () => [] },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  market: { type: Object, default: null },
  decision: { type: Object, default: null },
  position: { type: Object, default: null },
  summary: { type: Object, default: null },
  drawingScope: { type: String, default: '' },
  overlays: { type: Object, required: true },
  input: { type: Object, required: true },
  theme: { type: String, default: 'light' },
})
const emit = defineEmits(['cursor-change', 'param-change', 'set-overlay', 'ready', 'fatal-error'])
const el = ref(null),
  loading = ref(true)
const { isMobile } = useBreakpoint()
const showProfile = computed(() => props.overlays.stockChipProfile !== false && !isMobile.value)
const model = useMarketLabChartIndicators(props)
let adapter = null,
  disposed = false,
  observer = null,
  themeObserver = null
let fittedRows = null,
  fittedScope = '',
  rowGeneration = 0
const controller = new AbortController()
const drawing = useVelaDrawings({
  getAdapter: () => adapter,
  getScope: () => props.drawingScope,
  getAnchorTime: () => toVelaTime(props.rows[0]?.date),
})

onMounted(async () => {
  try {
    const initialRows = props.rows
    const initialSource = props.source
    const next = await createVelaChartAdapter({
      element: el.value,
      rows: props.rows,
      source: props.source,
      theme: props.theme,
      onCursor: handleCursor,
      onOverlayChange: (key, value) => emit('set-overlay', key, value),
      onError: handleFailure,
      signal: controller.signal,
    })
    if (disposed) {
      next.destroy()
      return
    }
    adapter = next
    if (initialRows !== props.rows || initialSource !== props.source) await adapter.setRows(props.rows, props.source)
    if (disposed) return
    await sync()
    if (disposed) return
    drawing.attach()
    adapter.fit()
    fittedRows = props.rows
    fittedScope = props.drawingScope
    observer = new ResizeObserver(() => {
      adapter?.resize()
    })
    observer.observe(el.value)
    themeObserver = new MutationObserver(syncTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    syncTheme()
    await waitForChartOperation(adapter.painted, { signal: controller.signal, label: 'Vela 首帧' })
    if (disposed) return
    loading.value = false
    emit('ready')
  } catch (error) {
    if (!disposed) emit('fatal-error', error)
  }
})
onBeforeUnmount(() => {
  disposed = true
  drawing.dispose()
  controller.abort()
  rowGeneration++
  observer?.disconnect()
  themeObserver?.disconnect()
  adapter?.destroy()
})
watch(
  () => [model.value, props.decision, props.replay, props.overlays],
  () => sync().catch(handleFailure),
  { deep: true },
)
watch(
  () => [props.rows, props.drawingScope, props.source?.symbol],
  async () => {
    const generation = ++rowGeneration
    emit('cursor-change', null)
    if (!adapter) return
    try {
      await adapter.setRows(props.rows, props.source)
      if (disposed || generation !== rowGeneration) return
      await sync()
      if (disposed || generation !== rowGeneration) return
      drawing.loadScope()
      if (props.rows !== fittedRows || props.drawingScope !== fittedScope) adapter.fit()
      fittedRows = props.rows
      fittedScope = props.drawingScope
    } catch (error) {
      if (!disposed && generation === rowGeneration) emit('fatal-error', error)
    }
  },
)
watch(() => props.theme, syncTheme)
watch(showProfile, () => sync().catch(handleFailure))

async function sync() {
  if (!adapter || disposed) return
  await adapter.sync(model.value, {
    rows: props.rows,
    costPath: props.costPath,
    overlays: props.overlays,
    profilePaintEnabled: !isMobile.value,
    markers: buildChartMarkers({
      rows: props.rows,
      replay: props.replay,
      decision: props.decision,
      overlays: props.overlays,
      formulaPath: props.formulaPath,
    }),
  })
  await adapter.whenReady()
  if (!disposed) {
    drawing.refresh()
  }
}
function handleFailure(error) {
  if (!disposed) emit('fatal-error', error)
}
function syncTheme() {
  adapter?.setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light')
}
function handleCursor(time) {
  const index = time === null ? -1 : props.rows.findIndex((row) => toVelaTime(row.date) === time)
  emit('cursor-change', index < 0 ? null : index)
}
</script>

<template>
  <div class="main-chart-shell" :aria-busy="loading">
    <div class="main-chart-chrome">
      <div class="chart-context-rail">
        <WorkbenchSummary :model="summary" compact />
        <slot name="engine-switch" />
      </div>
      <div class="chart-control-deck">
        <ChartDisplayTools
          :overlays="overlays"
          :ready="!loading"
          :chip-available="!isMobile"
          chip-source="Vela 可见区间成交量分布（OHLCV 代理）"
          @set-overlay="(key, value) => emit('set-overlay', key, value)"
        />
        <ChartStatusBar :input="input" @change="(field, value) => emit('param-change', field, value)" />
      </div>
    </div>
    <div class="main-chart-stage">
      <div ref="el" class="main-chart-canvas" />
      <span v-if="loading" class="vela-chart-loading" role="status">正在准备 Vela 研究图</span>
    </div>
  </div>
</template>

<style scoped>
.main-chart-shell[aria-busy='true'] .main-chart-canvas {
  pointer-events: none;
}
.chart-control-deck {
  grid-template-columns: minmax(0, 1fr) auto;
}
.vela-chart-loading {
  position: absolute;
  top: 48%;
  left: 40%;
  color: var(--muted);
}
@media (max-width: 1279px) {
  .chart-control-deck {
    grid-template-columns: 1fr;
  }
}
</style>
