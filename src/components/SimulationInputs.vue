<script setup>
import { computed } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
  graph: { type: Object, default: null },
})

const emit = defineEmits(['patch-input'])

function pctIn(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n / 100 : 0
}
function pctOut(v) {
  return Number.isFinite(v) ? Number((v * 100).toFixed(2)) : 0
}
function numIn(raw, fallback = 0) {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

const bandText = computed(() => {
  const band = props.graph?.deltaBands?.long
  if (!band) return '等待样本'
  return `${fmt(band.low)} · ${fmt(band.cost)} · ${fmt(band.high)}`
})
const horizonText = computed(() => {
  const days = props.graph?.inputs?.formulaHorizonSessions
  return Number.isFinite(days) ? `${days} 会话` : '待推导'
})

function fmt(value) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}
</script>

<template>
  <div class="si-card">
    <div class="si-card-head">
      <strong>GetDelta(P, T, σ, d)</strong>
      <code>{{ bandText }}</code>
    </div>

    <div class="si-form">
      <label>
        <span>入场价 P</span>
        <input
          :value="input.entryPrice"
          type="number"
          step="0.01"
          @input="emit('patch-input', { entryPrice: numIn($event.target.value, input.entryPrice) })"
        />
      </label>
      <label>
        <span>周期 T</span>
        <output>{{ horizonText }}</output>
      </label>
      <label>
        <span>波动率 σ (%)</span>
        <input
          :value="pctOut(input.iv)"
          type="number"
          step="0.5"
          @input="emit('patch-input', { iv: pctIn($event.target.value), ivSource: 'manual-scenario' })"
        />
      </label>
      <label>
        <span>增量 d (%)</span>
        <input
          :value="pctOut(input.deltaSlope)"
          type="number"
          step="0.5"
          @input="emit('patch-input', { deltaSlope: pctIn($event.target.value) })"
        />
      </label>
      <label>
        <span>止盈目标 (%)</span>
        <input
          :value="pctOut(input.exitTargetReturn)"
          type="number"
          step="0.5"
          @input="emit('patch-input', { exitTargetReturn: pctIn($event.target.value) })"
        />
      </label>
    </div>
  </div>
</template>

<style>
.si-card {
  display: grid;
  gap: 8px;
  padding: 9px 10px;
  border-radius: var(--r-md);
  background: var(--surface-alt);
  border: 1px solid var(--line);
}
.si-card-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}
.si-card-head strong {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--ink);
}
.si-card-head code {
  font-family: var(--mono);
  color: var(--green);
  font-size: 0.68rem;
}
.si-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.si-form label {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.si-form span {
  color: var(--muted);
  font-size: 0.64rem;
  font-weight: 600;
}
.si-form input,
.si-form output {
  min-width: 0;
  min-height: 28px;
  font-family: var(--mono);
  font-size: 0.76rem;
}
.si-form output {
  display: flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: var(--r-sm);
  background: var(--bg);
  border: 1px solid var(--line);
  color: var(--muted);
}
</style>
