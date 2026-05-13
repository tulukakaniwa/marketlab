<script setup>
defineProps({
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
</script>

<template>
  <section class="decision-panel">
    <article class="decision-hero">
      <span>低价买入判断 · {{ graph.profile?.label ?? '均衡' }}</span>
      <strong>{{ graph.decision?.state || '等待数据' }}</strong>
      <small>{{ graph.decision?.timing?.reason || graph.decision?.path || '载入 K 线后自动分析' }}</small>
    </article>

    <article class="position-hero">
      <span>仓位动作 / 卖出辅助</span>
      <strong>{{ graph.position?.action ?? '不进场' }}</strong>
      <small>{{ graph.position?.rule ?? '等待价格给出明确成本差。' }}</small>
    </article>

    <div class="decision-grid">
      <article>
        <span>第一笔</span>
        <strong>{{ money(graph.position?.firstNotional) }}</strong>
      </article>
      <article>
        <span>最大名义</span>
        <strong>{{ money(graph.position?.maxNotional) }}</strong>
      </article>
      <article>
        <span>风险预算</span>
        <strong>{{ money(graph.position?.riskBudget) }}</strong>
      </article>
      <article>
        <span>失效距离</span>
        <strong>{{ pct(graph.position?.stopDistance) }}</strong>
      </article>
      <article>
        <span>回归目标</span>
        <strong>{{ money(graph.position?.targetPrice) }}</strong>
      </article>
      <article>
        <span>保留现金</span>
        <strong>{{ money(graph.position?.reserveCash) }}</strong>
      </article>
    </div>

    <div class="decision-grid">
      <article>
        <span>观察窗口</span>
        <strong>{{ graph.decision?.holdingWindow ?? '无' }}</strong>
      </article>
      <article>
        <span>低价置信</span>
        <strong>{{ Math.round((graph.decision?.confidence ?? 0) * 100) }}%</strong>
      </article>
      <article>
        <span>近端成本</span>
        <strong>{{ format(market?.costRecent) }}</strong>
      </article>
      <article>
        <span>LP 库存</span>
        <strong>{{ format(graph.lpV3?.inventoryDelta) }}</strong>
      </article>
    </div>

    <article class="decision-list">
      <span>失效条件</span>
      <p v-for="item in graph.decision?.invalidations ?? []" :key="item">{{ item }}</p>
    </article>
  </section>
</template>
