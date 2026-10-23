<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ImpactReferenceLegend from '../ImpactReferenceLegend.vue'
import { createVelaChartAdapter } from '../../infrastructure/charting/velaChartAdapter.js'
import { toVelaTime } from '../../infrastructure/charting/velaResearchAdapter.js'
import { waitForChartOperation } from '../../infrastructure/charting/chartOperation.js'
import '../../styles/aligned-impact-chart.css'

const props = defineProps({
  rows: { type: Array, required: true },
  source: { type: Object, required: true },
  impactMap: { type: Object, default: null },
  theme: { type: String, default: 'light' },
})
const emit = defineEmits(['open-research', 'return-daily'])
const element = ref(null)
const loading = ref(true)
const error = ref('')
const hoverDate = ref(null)
const viewportMode = ref('nearby')
const selectedDate = computed(() => hoverDate.value ?? props.rows.at(-1)?.date ?? '')
const lastBar = computed(() => props.rows.at(-1))
const observationTime = computed(() => {
  const value = lastBar.value?.completedAt ?? lastBar.value?.closeTime
  const time = typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : '—'
})
const overlays = reactive({
  volume: true,
  impactReferenceMap: true,
  stockChipProfile: false,
  priceReferenceMap: false,
  priceBands: false,
  regime: false,
})
let adapter = null
let resizeObserver = null
let disposed = false
let generation = 0
let appliedRows = null
let appliedSource = null
let framed = false
const controller = new AbortController()

// This view consumes the parent's validated observation prefix. It never runs
// daily formulas, reads planning inputs, or changes the daily workbench cursor.
function chartInput() {
  return {
    rows: props.rows,
    costPath: [],
    markers: [],
    centerConfig: {},
    referenceMap: null,
    impactMap: props.impactMap,
    profilePaintEnabled: false,
    overlays: { ...overlays },
    priceScaleHints: scaleHints(),
  }
}

function scaleHints() {
  if (!overlays.impactReferenceMap || viewportMode.value === 'market') return []
  const byDate = new Map((props.impactMap?.path ?? []).map((point) => [point.date, point]))
  return props.rows.flatMap((row) => {
    const point = byDate.get(row.date)
    if (point?.status !== 'ready') return []
    const prices = (point.nodes ?? [])
      .filter((node) => ['lp', 'options'].includes(node.kind))
      .map((node) => node.price)
      .filter(
        (price) =>
          Number.isFinite(price) &&
          price > 0 &&
          (viewportMode.value === 'all' || (price >= row.close * 0.85 && price <= row.close * 1.15)),
      )
    return prices.length ? [{ date: row.date, min: Math.min(...prices), max: Math.max(...prices) }] : []
  })
}

function focusLatest() {
  if (!adapter || !props.rows.length) return
  const rows = props.rows
  const last = toVelaTime(rows.at(-1).date)
  const previous = rows.length > 1 ? toVelaTime(rows.at(-2).date) : last - 300000
  const spacing = Math.max(1, last - previous)
  adapter.chart.renderer.set('autoScale', true)
  adapter.chart.setVisibleRange({
    from: toVelaTime(rows[Math.max(0, rows.length - 100)].date),
    to: last + spacing * 12,
  })
  framed = true
}

function setViewportMode(mode) {
  viewportMode.value = mode
  adapter?.chart.renderer.set('autoScale', true)
}

async function refresh() {
  const ticket = ++generation
  if (!adapter || disposed) return
  const current = adapter
  const rows = props.rows
  const source = props.source
  const changed = rows !== appliedRows || source !== appliedSource
  try {
    if (changed) {
      loading.value = true
      hoverDate.value = null
      // setRows clears the renderer's previous research payload before its
      // asynchronous market replacement, so old nodes cannot linger.
      await current.setRows(rows, source)
      if (disposed || ticket !== generation) return
      appliedRows = rows
      appliedSource = source
    }
    await current.sync({ dates: rows.map((row) => row.date), groups: [], centerDescriptors: [] }, chartInput())
    await current.whenReady()
    if (disposed || ticket !== generation) return
    if (changed || !framed) focusLatest()
    loading.value = false
  } catch (cause) {
    if (!disposed && ticket === generation) fail(cause)
  }
}

function fail(cause) {
  if (disposed) return
  generation++
  error.value = cause instanceof Error ? cause.message : String(cause)
  loading.value = false
  adapter?.destroy()
  adapter = null
}

function handleCursor(time) {
  if (disposed || loading.value) return
  hoverDate.value = props.rows.find((row) => toVelaTime(row.date) === time)?.date ?? null
}

onMounted(async () => {
  const initialRows = props.rows
  const initialSource = props.source
  try {
    const next = await createVelaChartAdapter({
      element: element.value,
      rows: initialRows,
      source: initialSource,
      theme: props.theme,
      signal: controller.signal,
      onCursor: handleCursor,
      onOverlayChange: (key, enabled) => {
        if (!disposed && ['volume', 'impactReferenceMap'].includes(key)) overlays[key] = enabled
      },
      onError: fail,
    })
    if (disposed || error.value) {
      next.destroy()
      return
    }
    adapter = next
    appliedRows = initialRows
    appliedSource = initialSource
    adapter.setTheme(props.theme)
    await refresh()
    if (disposed || !adapter) return
    resizeObserver = new ResizeObserver(() => adapter?.resize())
    resizeObserver.observe(element.value)
    await waitForChartOperation(adapter.painted, { signal: controller.signal, label: '研究行情首帧' })
  } catch (cause) {
    if (!disposed) fail(cause)
  }
})

watch(
  () => [props.rows, props.source, props.impactMap, overlays.volume, overlays.impactReferenceMap, viewportMode.value],
  refresh,
  { deep: true },
)
watch(
  () => props.theme,
  (theme) => adapter?.setTheme(theme),
)
onBeforeUnmount(() => {
  disposed = true
  generation++
  resizeObserver?.disconnect()
  controller.abort()
  adapter?.destroy()
  adapter = null
})
</script>

<template>
  <section class="main-chart-shell aligned-impact-chart" :aria-busy="loading" aria-label="时间对齐研究行情">
    <div class="main-chart-chrome">
      <div class="aligned-impact-toolbar">
        <strong>{{ source.symbol }} · {{ source.timeframe }} 研究行情</strong>
        <button type="button" @click="emit('return-daily')">返回日线工作台</button>
        <button type="button" @click="emit('open-research')">研究样本</button>
        <button
          type="button"
          :aria-pressed="overlays.impactReferenceMap"
          :disabled="loading || Boolean(error)"
          @click="overlays.impactReferenceMap = !overlays.impactReferenceMap"
        >
          研究价位
        </button>
        <button
          type="button"
          :aria-pressed="overlays.volume"
          :disabled="loading || Boolean(error)"
          @click="overlays.volume = !overlays.volume"
        >
          成交量
        </button>
        <button type="button" :disabled="loading || Boolean(error)" @click="focusLatest">最近 100 根</button>
      </div>
      <div class="aligned-impact-clock">
        <span>已收盘行情 · UTC</span>
        <span>观察截至 {{ observationTime }}</span>
        <span>● LP · ◆ 期权 · 点面积＝来源内相对强度</span>
      </div>
      <div class="aligned-impact-toolbar" role="group" aria-label="研究价位显示范围">
        <span class="aligned-impact-range-label">价格视窗</span>
        <button
          v-for="mode in [
            { id: 'nearby', label: '附近价位 ±15%' },
            { id: 'market', label: '行情范围' },
            { id: 'all', label: '全部价位' },
          ]"
          :key="mode.id"
          type="button"
          :aria-pressed="viewportMode === mode.id"
          :disabled="loading || Boolean(error)"
          @click="setViewportMode(mode.id)"
        >
          {{ mode.label }}
        </button>
      </div>
      <ImpactReferenceLegend
        v-if="overlays.impactReferenceMap"
        :snapshot="impactMap"
        :date="selectedDate"
        @open-research="emit('open-research')"
      />
    </div>
    <div class="main-chart-stage">
      <div ref="element" class="main-chart-canvas" />
      <p v-if="error" class="aligned-impact-message" role="alert">研究行情未能显示：{{ error }}</p>
      <p v-else-if="loading" class="aligned-impact-message" role="status">正在对齐研究行情…</p>
    </div>
  </section>
</template>
