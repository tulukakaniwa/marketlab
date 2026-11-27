<script setup>
import { computed, nextTick, ref } from 'vue'
import ParamPopover from './ParamPopover.vue'

const props = defineProps({
  input: { type: Object, required: true },
})

const emit = defineEmits(['change'])

const openField = ref(null)
const popoverWrapper = ref(null)

const FIELDS = [
  {
    id: 'entryPrice',
    label: '入场',
    title: 'GetDelta 入场价 P',
    format: (v) => (Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'),
  },
  {
    id: 'iv',
    label: 'IV',
    title: '年化波动率 σ',
    format: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—'),
  },
  {
    id: 'deltaSlope',
    label: 'd',
    title: '目标增量 d',
    format: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—'),
  },
  {
    id: 'exitTargetReturn',
    label: '止盈',
    title: '退出目标收益率',
    format: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(0)}%` : '—'),
  },
]

function open(field) {
  openField.value = field
  nextTick(() => {
    document.addEventListener('mousedown', onOutside)
  })
}

function close() {
  openField.value = null
  document.removeEventListener('mousedown', onOutside)
}

function onOutside(e) {
  if (popoverWrapper.value && !popoverWrapper.value.contains(e.target)) {
    close()
  }
}

function onConfirm(value) {
  emit('change', openField.value, value)
  close()
}

const currentValue = computed(() => (openField.value ? props.input[openField.value] : 0))
</script>

<template>
  <div class="chart-status-bar">
    <button
      v-for="f in FIELDS"
      :key="f.id"
      type="button"
      :class="['csb-chip', { open: openField === f.id }]"
      :title="f.title"
      @click="open(f.id)"
    >
      <span class="csb-label">{{ f.label }}</span>
      <strong>{{ f.format(input[f.id]) }}</strong>
    </button>

    <div v-if="openField" ref="popoverWrapper" class="csb-popover-wrap">
      <ParamPopover :field="openField" :value="currentValue" @confirm="onConfirm" @cancel="close" />
    </div>
  </div>
</template>

<style>
.chart-status-bar {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-sm);
  background: var(--bg);
  border: 1px solid var(--line);
  z-index: 24;
  flex-shrink: 0;
}
.csb-chip {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
  min-height: 22px;
  padding: 2px 7px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--ink);
  font-size: 0.72rem;
}
.csb-chip:hover {
  background: var(--surface-hover);
  border-color: transparent;
}
.csb-chip.open {
  border-color: color-mix(in srgb, var(--green) 45%, transparent);
  background: var(--surface-active);
  color: var(--green);
}
.csb-label {
  color: var(--muted);
  font-size: 0.66rem;
  font-weight: 600;
}
.csb-chip strong {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.csb-popover-wrap {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
}
@media (max-width: 1024px) {
  .csb-popover-wrap {
    right: auto;
    left: 0;
  }
}
</style>
