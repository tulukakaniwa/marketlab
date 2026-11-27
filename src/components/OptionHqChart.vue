<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { buildOptionGreeksChartModel } from '../domain/formula-research/optionGreeksSeries.js'
import { formatFormulaInputList } from '../domain/formula-research/formulaInputLabels.js'
import { createHqOptionChartAdapter } from '../infrastructure/charting/hqOptionChartAdapter.js'

const props = defineProps({
  rows: { type: Array, default: () => [] },
  sourceLabel: { type: String, default: '' },
  market: { type: Object, default: null },
  graph: { type: Object, default: null },
  formulaPath: { type: Array, default: () => [] },
})

const host = ref(null)
const loading = ref(false)
const error = ref('')
let adapter = null
let resizeObserver = null
let controller = null
let generation = 0

const optionModel = computed(() =>
  buildOptionGreeksChartModel({
    rows: props.rows,
    formulaPath: props.formulaPath,
    graph: props.graph,
    market: props.market,
  }),
)

const canMountChart = computed(() => optionModel.value.status === 'research-only' && props.rows.length >= 2)
const windowedRows = computed(() => props.rows.slice(-Math.max(2, optionModel.value.dates.length || 160)))
const missingHint = computed(() =>
  optionModel.value.missingInputs.length
    ? formatFormulaInputList(optionModel.value.missingInputs)
    : '期权到期会话与行权价',
)

function isDarkTheme() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

async function mountOptionChart() {
  const ticket = ++generation
  controller?.abort()
  controller = null
  adapter?.destroy()
  adapter = null
  error.value = ''

  if (!canMountChart.value) {
    loading.value = false
    return
  }

  loading.value = true
  await nextTick()
  if (ticket !== generation || !host.value) return

  const currentController = new AbortController()
  controller = currentController
  try {
    const next = await createHqOptionChartAdapter({
      element: host.value,
      getRows: () => windowedRows.value,
      getSource: () => ({ symbol: props.sourceLabel || 'OPTION', label: props.sourceLabel || '期权标的' }),
      getOptionModel: () => optionModel.value,
      dark: isDarkTheme(),
      signal: currentController.signal,
    })
    if (ticket !== generation || currentController.signal.aborted) {
      next.destroy()
      return
    }
    adapter = next
    loading.value = false
  } catch (caught) {
    if (ticket !== generation || currentController.signal.aborted) return
    error.value = caught instanceof Error ? caught.message : String(caught)
    loading.value = false
  }
}

onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => adapter?.resize())
    if (host.value) resizeObserver.observe(host.value)
  }
  mountOptionChart()
})

watch(
  () => [canMountChart.value, optionModel.value, props.sourceLabel],
  () => {
    if (resizeObserver && host.value) resizeObserver.observe(host.value)
    mountOptionChart()
  },
)

onBeforeUnmount(() => {
  generation++
  controller?.abort()
  resizeObserver?.disconnect()
  adapter?.destroy()
  adapter = null
})
</script>

<template>
  <section class="ohq-shell" aria-label="HQ 期权 Greeks 序列终端">
    <header class="ohq-head">
      <div>
        <span class="ohq-badge">HQ 期权终端</span>
        <strong>标的与 Δ / Γ / Θ 序列</strong>
      </div>
      <small>仅研究 · 不写入模拟挂单</small>
    </header>

    <div v-if="!canMountChart" class="ohq-empty">
      <span>待补充期权参数：{{ missingHint }}</span>
      <small>在「设置 → 期权组合研究」填写行权价与距到期交易会话后，按需加载 HQ 期权多轴图。</small>
    </div>

    <div v-else class="ohq-stage">
      <div ref="host" class="ohq-canvas" />
      <div v-if="loading" class="ohq-overlay" role="status">正在按需加载 HQ 期权序列…</div>
      <div v-else-if="error" class="ohq-overlay ohq-error" role="alert">
        <span>HQ 期权图未就绪：{{ error }}</span>
        <button type="button" @click="mountOptionChart">重试</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ohq-shell {
  display: grid;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  padding: 8px 10px;
}
.ohq-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ohq-head div {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.ohq-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-active);
  color: var(--green);
  font-size: 0.6rem;
  font-weight: 900;
  letter-spacing: 0.04em;
}
.ohq-head strong {
  font-size: 0.76rem;
}
.ohq-head small {
  color: var(--muted);
  font-size: 0.64rem;
}
.ohq-empty {
  display: grid;
  gap: 3px;
  padding: 8px;
  border: 1px dashed var(--line);
  border-radius: 6px;
  background: var(--surface-alt);
  font-size: 0.72rem;
}
.ohq-empty small {
  color: var(--muted);
  font-size: 0.66rem;
  line-height: 1.4;
}
.ohq-stage {
  position: relative;
  height: 240px;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg);
}
.ohq-canvas {
  width: 100%;
  height: 100%;
}
.ohq-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  color: var(--muted);
  font-size: 0.74rem;
  padding: 10px;
  text-align: center;
}
.ohq-error {
  color: var(--red);
}
.ohq-error button {
  padding: 3px 9px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--panel);
  color: var(--ink);
  font-size: 0.7rem;
  cursor: pointer;
}
</style>
