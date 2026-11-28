<script setup>
import { computed } from 'vue'

const props = defineProps({
  title: { type: String, required: true },
  orders: { type: Array, required: true },
  diagnostics: { type: Object, default: null },
})

const hasDiagnostics = computed(() => Boolean(props.diagnostics?.orders?.length))

function diagAt(index) {
  return props.diagnostics?.orders?.[index] ?? null
}

function num(value, digits = 2) {
  if (!Number.isFinite(value)) return '无'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value)
}

function signed(value) {
  return `${value > 0 ? '+' : ''}${num(value)}`
}

function pct(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}
</script>

<template>
  <section class="order-table">
    <header>{{ title }}</header>
    <table>
      <thead>
        <tr>
          <th>动作</th>
          <th>价格</th>
          <th v-if="hasDiagnostics">√P 几何价</th>
          <th>目标</th>
          <th>模拟名义</th>
          <th>模拟数量</th>
          <th v-if="hasDiagnostics">首达触价</th>
          <th>情景盈亏</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(order, idx) in orders" :key="`${order.side}-${order.price}`">
          <td>{{ order.role }}</td>
          <td>{{ num(order.price) }}</td>
          <td v-if="hasDiagnostics">{{ num(diagAt(idx)?.geometricPrice) }}</td>
          <td>{{ num(order.targetPrice) }}</td>
          <td>{{ num(order.notional) }}</td>
          <td>{{ num(order.amount, 6) }}</td>
          <td v-if="hasDiagnostics">{{ pct(diagAt(idx)?.fillBeforeTargetProb) }}</td>
          <td>{{ signed(order.expectedProfit) }}</td>
        </tr>
        <tr v-if="!orders.length">
          <td :colspan="hasDiagnostics ? 8 : 6">未触发候选条件</td>
        </tr>
      </tbody>
    </table>
    <div v-if="hasDiagnostics && Number.isFinite(diagnostics?.expectedFilledNotional)" class="ot-diag-bar">
      <span>期望成交 {{ num(diagnostics.expectedFilledNotional) }}</span>
      <span>加权均价 {{ num(diagnostics.probabilityWeightedEntryPrice) }}</span>
      <span v-if="Number.isFinite(diagnostics?.markBarrierPassage?.targetBeforeStopProb)">
        目标先达 {{ pct(diagnostics.markBarrierPassage.targetBeforeStopProb) }}
      </span>
    </div>
  </section>
</template>
