<script setup>
import { computed } from 'vue'
import {
  CHART_ENGINE_PROFILES,
  getChartEngineNotice,
  normalizeChartEngine,
} from '../domain/research-visualization/chartEngines.js'

const props = defineProps({
  engine: { type: String, default: 'vela' },
  pendingEngine: { type: String, default: 'hqchart' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['change', 'retry'])

const activeEngine = computed(() => normalizeChartEngine(props.engine))
const options = Object.values(CHART_ENGINE_PROFILES)
const notice = computed(() => getChartEngineNotice(activeEngine.value))
const visibleNotice = computed(() =>
  activeEngine.value === 'vela'
    ? '研究副图按量级分窗；公式与手绘沿用原口径。'
    : activeEngine.value === 'hqchart'
      ? 'Lab 自研指标 + HQ 通用工具；标记仍保留。'
      : '只换图表工具，不改公式与结论。',
)
</script>

<template>
  <section class="chart-engine-switcher" aria-label="图表引擎">
    <div class="chart-engine-options" role="radiogroup" aria-label="选择图表引擎">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        class="chart-engine-option"
        :class="{ active: activeEngine === option.id, pending: loading && option.id === pendingEngine }"
        role="radio"
        :aria-checked="activeEngine === option.id"
        :aria-busy="loading && option.id === pendingEngine"
        :disabled="loading && option.id === pendingEngine"
        @click="emit('change', option.id)"
      >
        <strong>{{ option.label }}</strong>
        <small>{{ option.description }}</small>
        <i v-if="loading && option.id === pendingEngine">加载中</i>
      </button>
    </div>
    <p
      class="chart-engine-boundary"
      :class="{ error: Boolean(error) }"
      :aria-label="error || notice || visibleNotice"
      :title="error || notice || visibleNotice"
      aria-live="polite"
    >
      <template v-if="error">
        {{ error }}
        <button type="button" @click="emit('retry')">重试图表</button>
      </template>
      <template v-else>{{ visibleNotice }}</template>
    </p>
  </section>
</template>
