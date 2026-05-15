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
const rfrP = computed({ get: () => pctOut(props.input.riskFreeRate), set: (v) => { props.input.riskFreeRate = pctIn(v) } })
</script>

<template>
  <div class="si-form">
    <label><span>入场价</span><input v-model.number="input.entryPrice" type="number" step="0.01" /></label>
    <label><span>窗口（天）</span><input v-model.number="input.holdingDays" type="number" min="1" step="1" /></label>
    <label><span>波动率%</span><input v-model.number="ivP" type="number" step="0.5" /></label>
    <label><span>目标%</span><input v-model.number="trP" type="number" step="0.5" /></label>
    <label><span>本金</span><input v-model.number="input.capital" type="number" step="100" /></label>
    <label><span>底仓名义</span><input v-model.number="input.baseNotional" type="number" step="100" /></label>
    <label><span>行权价</span><input v-model.number="input.strikePrice" type="number" step="0.01" /></label>
    <label><span>无风险利率%</span><input v-model.number="rfrP" type="number" step="0.1" /></label>
    <label><span>期权类型</span>
      <select v-model="input.optionType">
        <option value="put">认沽 put</option>
        <option value="call">认购 call</option>
      </select>
    </label>
    <label><span>期权组合</span>
      <select v-model="input.optionStrategy">
        <option value="single">单腿</option>
        <option value="vertical">价差</option>
        <option value="straddle">跨式</option>
        <option value="strangle">宽跨式</option>
        <option value="collar">领口</option>
      </select>
    </label>
    <label><span>期权方向</span>
      <select v-model="input.optionSide">
        <option value="long">多 legs</option>
        <option value="short">空 legs</option>
      </select>
    </label>
    <label><span>第二行权价</span><input v-model.number="input.strikePrice2" type="number" step="0.01" /></label>
    <label><span>合约数量</span><input v-model.number="input.optionQuantity" type="number" min="0" step="1" /></label>
    <label><span>合约乘数</span><input v-model.number="input.optionMultiplier" type="number" min="0.0001" step="1" /></label>
    <label><span>权利金</span><input v-model.number="input.optionPremium" type="number" min="0" step="0.01" /></label>
    <label><span>区间宽度</span><input v-model.number="input.rangeWidth" type="number" step="0.01" /></label>
  </div>
</template>

<style>
.si-form { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 10px; }
.si-form label { display: grid; gap: 2px; }
.si-form span { color: var(--muted); font-size: 0.62rem; font-weight: 800; text-transform: uppercase; }
.si-form input, .si-form select { min-height: 28px; padding: 3px 7px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.78rem; font-variant-numeric: tabular-nums; }
.si-form select { font-weight: 600; }
</style>
