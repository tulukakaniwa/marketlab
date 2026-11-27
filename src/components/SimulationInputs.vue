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
  if (!band) return '等待市场样本'
  return `${fmt(band.low)} / ${fmt(band.cost)} / ${fmt(band.high)}`
})
const horizonText = computed(() => {
  const days = props.graph?.inputs?.formulaHorizonSessions
  return Number.isFinite(days) ? `${days} 个交易会话` : '等待结构目标'
})

function fmt(value) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}
</script>

<template>
  <div class="si-card">
    <div class="si-card-head">
      <strong>GetDelta 价格带</strong>
      <small>P + H(q) + s + d</small>
    </div>

    <div class="si-form">
      <label>
        <span>入场价</span>
        <input
          :value="input.entryPrice"
          type="number"
          step="0.01"
          @input="emit('patch-input', { entryPrice: numIn($event.target.value, input.entryPrice) })"
        />
      </label>
      <label>
        <span>公式周期</span>
        <output>{{ horizonText }}</output>
      </label>
      <label>
        <span>情景 σ%</span>
        <input
          :value="pctOut(input.iv)"
          type="number"
          step="0.5"
          @input="emit('patch-input', { iv: pctIn($event.target.value), ivSource: 'manual-scenario' })"
        />
      </label>
      <label>
        <span>目标增量 d%</span>
        <input
          :value="pctOut(input.deltaSlope)"
          type="number"
          step="0.5"
          @input="emit('patch-input', { deltaSlope: pctIn($event.target.value) })"
        />
      </label>
      <label>
        <span>退出目标%</span>
        <input
          :value="pctOut(input.exitTargetReturn)"
          type="number"
          step="0.5"
          @input="emit('patch-input', { exitTargetReturn: pctIn($event.target.value) })"
        />
      </label>
    </div>
    <p class="si-link">多头低/成本/高：{{ bandText }}。模拟挂单继续叠加成本带、策略档位和账户权益。</p>
  </div>
</template>

<style>
.si-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface-alt);
}
.si-card-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: end;
}
.si-card-head strong {
  font-size: 0.9rem;
}
.si-card-head small {
  color: var(--muted);
  font-size: 0.64rem;
  font-weight: 700;
  text-align: right;
}
.si-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.si-form label {
  display: grid;
  gap: 2px;
}
.si-form span {
  color: var(--muted);
  font-size: 0.62rem;
  font-weight: 800;
  text-transform: uppercase;
}
.si-form input,
.si-form output,
.si-form select {
  min-height: 28px;
  padding: 3px 7px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--bg);
  color: var(--ink);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}
.si-form output {
  display: flex;
  align-items: center;
}
.si-form select {
  font-weight: 600;
}
.si-link {
  margin: 0;
  color: var(--muted);
  font-size: 0.66rem;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
</style>
