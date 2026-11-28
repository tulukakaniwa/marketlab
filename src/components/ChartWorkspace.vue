<script setup>
import { computed, ref } from 'vue'
import { useChartWorkspace } from '../composables/useChartWorkspace.js'

const props = defineProps({
  rows: { type: Array, required: true },
  source: { type: Object, default: null },
  costPath: { type: Array, required: true },
  formulaPath: { type: Array, required: true },
  causalPath: { type: Array, default: () => [] },
  centerPath: { type: Array, default: () => [] },
  referenceMap: { type: Object, default: null },
  referenceQuery: { type: Object, default: null },
  impactMap: { type: Object, default: null },
  centerConfig: { type: Object, default: () => ({}) },
  entryPrice: { type: Number, required: true },
  replay: { type: Object, required: true },
  market: { type: Object, default: null },
  decision: { type: Object, default: null },
  position: { type: Object, default: null },
  summary: { type: Object, default: null },
  drawingScope: { type: String, default: '' },
  overlays: { type: Object, required: true },
  input: { type: Object, required: true },
  chartStrategy: { type: Object, default: null },
  chartStrategyId: { type: String, default: 'off' },
  chartStrategyCatalog: { type: Array, default: () => [] },
  theme: { type: String, default: 'light' },
})

const emit = defineEmits([
  'cursor-change',
  'param-change',
  'center-input-change',
  'set-overlay',
  'set-chart-strategy',
  'native-settings-change',
  'open-market-impact',
  'open-portfolio-rotation',
])
const workspace = useChartWorkspace()
const runtimeLoading = ref(false)
const currentComponent = computed(() => workspace.activeComponent.value)
const engineKey = computed(() => `vela:${props.drawingScope}`)
const switchLoading = computed(() => workspace.loading.value || runtimeLoading.value)

function handleFailure(error) {
  runtimeLoading.value = false
  emit('native-settings-change', false)
  workspace.fallback(error)
}
function handleReady() {
  runtimeLoading.value = false
  workspace.confirmReady()
  emit('native-settings-change', true)
}
function handleLoading(value) {
  runtimeLoading.value = value
  if (value) emit('native-settings-change', false)
}
</script>

<template>
  <div class="chart-workspace">
    <component
      :is="currentComponent"
      v-if="currentComponent"
      :key="engineKey"
      v-bind="props"
      @param-change="(field, value) => emit('param-change', field, value)"
      @center-input-change="(command) => emit('center-input-change', command)"
      @cursor-change="(index) => emit('cursor-change', index)"
      @set-overlay="(key, value) => emit('set-overlay', key, value)"
      @set-chart-strategy="(id) => emit('set-chart-strategy', id)"
      @loading-change="handleLoading"
      @fatal-error="handleFailure"
      @ready="handleReady"
      @open-market-impact="emit('open-market-impact')"
      @open-portfolio-rotation="emit('open-portfolio-rotation')"
    />
    <section v-else class="main-chart-shell">
      <div class="chart-workspace-state" role="status" :aria-busy="switchLoading">
        <p>{{ workspace.fallbackError.value || (switchLoading ? '正在加载 Vela 研究图…' : '图表未就绪') }}</p>
        <button v-if="!switchLoading" type="button" class="chart-retry-btn" @click="workspace.retry">重试加载</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.chart-workspace-state {
  display: grid;
  gap: 10px;
  place-content: center;
  justify-items: center;
  color: var(--muted);
  padding: 24px;
  text-align: center;
}
.chart-workspace-state p {
  margin: 0;
  font-size: 0.82rem;
}
.chart-retry-btn {
  padding: 6px 14px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--bg);
  color: var(--ink);
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
}
.chart-retry-btn:hover {
  border-color: var(--green);
  color: var(--green);
}
</style>
