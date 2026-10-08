<script setup>
import { computed, ref } from 'vue'
import ChartEngineSwitcher from './ChartEngineSwitcher.vue'
import { useChartWorkspace } from '../composables/useChartWorkspace.js'

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

const emit = defineEmits(['cursor-change', 'param-change', 'set-overlay'])
const workspace = useChartWorkspace()
const runtimeLoading = ref(false)
const currentComponent = computed(() => workspace.activeComponent.value)
const renderedEngine = computed(() => workspace.displayEngine.value)
// The official unified history has no public clear API. Start fresh on a new
// source so native Undo cannot revive drawings or indicators from another source.
const engineKey = computed(() =>
  renderedEngine.value === 'vela' ? `vela:${props.drawingScope}` : renderedEngine.value,
)
const switchLoading = computed(() => workspace.loading.value || runtimeLoading.value)

function changeEngine(engine) {
  if (engine === workspace.engine.value && !workspace.requestedEngine.value) return
  emit('cursor-change', null)
  runtimeLoading.value = false
  workspace.selectEngine(engine)
}
function handleFailure(error) {
  runtimeLoading.value = false
  workspace.fallback(error, renderedEngine.value)
}
function handleReady() {
  runtimeLoading.value = false
  workspace.confirmReady(renderedEngine.value)
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
      @cursor-change="(index) => emit('cursor-change', index)"
      @set-overlay="(key, value) => emit('set-overlay', key, value)"
      @loading-change="(value) => (runtimeLoading = value)"
      @fatal-error="handleFailure"
      @ready="handleReady"
    >
      <template #engine-switch>
        <ChartEngineSwitcher
          :engine="renderedEngine"
          :loading="switchLoading"
          :pending-engine="workspace.requestedEngine.value || workspace.engine.value"
          :error="workspace.fallbackError.value"
          @change="changeEngine"
          @retry="workspace.retry"
        />
      </template>
    </component>
    <section v-else class="main-chart-shell">
      <div class="main-chart-chrome">
        <ChartEngineSwitcher
          :engine="renderedEngine"
          :loading="switchLoading"
          :pending-engine="workspace.requestedEngine.value || workspace.engine.value"
          :error="workspace.fallbackError.value"
          @change="changeEngine"
          @retry="workspace.retry"
        />
      </div>
      <div class="chart-workspace-state" role="status" :aria-busy="switchLoading">
        {{ switchLoading ? '正在加载图表引擎' : '图表未就绪，可重试或切换引擎' }}
      </div>
    </section>
  </div>
</template>

<style scoped>
.chart-workspace-state {
  display: grid;
  place-content: center;
  color: var(--muted);
}
</style>
