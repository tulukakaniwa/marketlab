<script setup>
import { computed } from 'vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
})

function format(value) {
  if (!Number.isFinite(value)) return '无'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 }).format(value)
}

function money(value) {
  if (!Number.isFinite(value)) return '无'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function pct(value) {
  if (!Number.isFinite(value)) return '无'
  return `${(value * 100).toFixed(1)}%`
}

const facts = computed(() => [
  { label: '价格位置', value: props.graph.decision?.regime ?? '等待数据' },
  { label: '成本偏离', value: pct(props.market?.costDistance) },
  { label: 'Z 值', value: Number.isFinite(props.graph.decision?.timing?.zScore) ? `${props.graph.decision.timing.zScore.toFixed(2)}σ` : '无' },
  { label: '观察窗口', value: props.graph.decision?.holdingWindow ?? '无' },
  { label: '近端成本', value: format(props.market?.costRecent) },
  { label: '成本带', value: `${money(props.market?.costLow)} / ${money(props.market?.costHigh)}` },
])

const triggered = computed(() => props.graph.decision?.triggeredConditions ?? [])
const blocked = computed(() => props.graph.decision?.blockedReasons ?? [])
const missing = computed(() => props.graph.decision?.missingInputs ?? [])
</script>

<template>
  <section class="decision-panel">
    <article class="decision-hero">
      <span>当前事实 · {{ graph.profile?.label ?? '均衡' }}</span>
      <strong>{{ graph.decision?.state || '等待数据' }}</strong>
      <small>{{ graph.decision?.timing?.reason || graph.decision?.path || '载入 K 线后显示事实状态' }}</small>
    </article>

    <article class="position-hero">
      <span>默认计划状态</span>
      <strong>{{ graph.position?.action ?? '不进场' }}</strong>
      <small>{{ graph.position?.rule ?? '默认条件未触发。' }}</small>
    </article>

    <div class="decision-grid">
      <article v-for="fact in facts" :key="fact.label">
        <span>{{ fact.label }}</span>
        <strong>{{ fact.value }}</strong>
      </article>
    </div>

    <article class="decision-list">
      <span>触发条件</span>
      <p v-if="!triggered.length">无默认条件触发</p>
      <p v-for="item in triggered" :key="item">{{ item }}</p>
    </article>

    <article class="decision-list">
      <span>未触发 / 缺失</span>
      <p v-if="!blocked.length && !missing.length">无</p>
      <p v-for="item in blocked" :key="item">{{ item }}</p>
      <p v-for="item in missing" :key="item">缺少 {{ item }}</p>
    </article>
  </section>
</template>
