<script setup>
import { computed } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
})

// 百分号转换：输入 0.05（5%）→ 显示 5；输入 5 → 存储 0.05
function pctIn(v) { const n = Number(v); return Number.isFinite(n) ? n / 100 : 0 }
function pctOut(v) { return Number.isFinite(v) ? Number((v * 100).toFixed(2)) : 0 }

// 波动率、目标回报、无风险利率 三个百分号字段
const ivP = computed({ get: () => pctOut(props.input.iv), set: (v) => { props.input.iv = pctIn(v) } })
const trP = computed({ get: () => pctOut(props.input.targetReturn), set: (v) => { props.input.targetReturn = pctIn(v) } })
</script>

<template>
  <div class="si-card">
    <div class="si-card-head">
      <strong>默认价格带</strong>
      <small>进入 OrderPlan 的主链输入</small>
    </div>

    <div class="si-form">
      <label><span>入场价</span><input v-model.number="input.entryPrice" type="number" step="0.01" /></label>
      <label><span>窗口</span><input v-model.number="input.holdingDays" type="number" min="1" step="1" /></label>
      <label><span>波动率%</span><input v-model.number="ivP" type="number" step="0.5" /></label>
      <label><span>目标%</span><input v-model.number="trP" type="number" step="0.5" /></label>
    </div>
  </div>
</template>

<style>
.si-card { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-alt); }
.si-card-head { display: flex; justify-content: space-between; gap: 8px; align-items: end; }
.si-card-head strong { font-size: 0.9rem; }
.si-card-head small { color: var(--muted); font-size: 0.64rem; font-weight: 700; text-align: right; }
.si-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.si-form label { display: grid; gap: 2px; }
.si-form span { color: var(--muted); font-size: 0.62rem; font-weight: 800; text-transform: uppercase; }
.si-form input, .si-form select { min-height: 28px; padding: 3px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.si-form select { font-weight: 600; }
</style>
