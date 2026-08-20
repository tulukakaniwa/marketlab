<script setup>
import { computed, onMounted, ref } from 'vue'

const STATUS_ORDER = ['观察', '等待', '剔除', '需刷新数据']
const pool = ref(null)
const loading = ref(true)
const error = ref('')

const groups = computed(() => {
  const candidates = pool.value?.candidatesAll ?? []
  const limit = pool.value?.topN ?? 10
  return STATUS_ORDER.map((status) => ({
    status,
    total: candidates.filter((candidate) => candidate.candidateStatus === status).length,
    items: candidates.filter((candidate) => candidate.candidateStatus === status).slice(0, limit),
  }))
})

onMounted(async () => {
  try {
    const response = await fetch('/recommended-pool/data.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    pool.value = await response.json()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    loading.value = false
  }
})

function formatNumber(value, digits = 2) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : '—'
}
</script>

<template>
  <main class="pool-page">
    <header class="pool-header">
      <div>
        <p>Market Lab · A股 · 严格门禁</p>
        <h1>A股研究门禁报告</h1>
      </div>
      <a href="/recommended-pool/index.html">打开完整可配置报告</a>
    </header>

    <section v-if="loading" class="pool-state">正在读取研究证据…</section>
    <section v-if="!loading && error" class="pool-state pool-error">报告读取失败：{{ error }}</section>

    <template v-if="!loading && !error">
      <section class="pool-summary">
        <article>
          <span>筛选范围</span>
          <strong>{{ pool.canonicalSummary.audit.considered }} → {{ pool.totalCandidates }}</strong>
        </article>
        <article v-for="status in STATUS_ORDER" :key="status">
          <span>{{ status }}</span>
          <strong>{{ pool.canonicalSummary.statusCounts[status] }}</strong>
        </article>
        <article>
          <span>短持信号</span>
          <strong>{{ pool.canonicalSummary.latestSignalCount }}</strong>
        </article>
      </section>

      <section class="agent-review">
        <p>LLM Agent 结论</p>
        <h2>
          {{ pool.agentReview.status === 'reviewed' ? `${pool.agentReview.agent.name} 已复核` : '待 Agent 复核' }}
        </h2>
        <p>{{ pool.agentReview.conclusion?.summary ?? pool.agentReview.message }}</p>
      </section>

      <section v-for="group in groups" :key="group.status" class="pool-group">
        <header>
          <h2>{{ group.status }}</h2>
          <span>展示 {{ group.items.length }} / 共 {{ group.total }}</span>
        </header>
        <p v-if="!group.items.length" class="empty">本轮没有标的进入该状态。</p>
        <div v-if="group.items.length" class="pool-table">
          <div class="pool-row pool-head">
            <span>标的</span><span>严格诊断分</span><span>状态</span><span>执行</span><span>数据截止</span>
          </div>
          <div v-for="item in group.items" :key="item.symbol" class="pool-row">
            <span
              ><b>{{ item.label }}</b
              ><small>{{ item.symbol }} · {{ item.market }}</small></span
            >
            <span>{{ formatNumber(item.score, 0) }}</span>
            <span>{{ item.candidateStatus }}</span>
            <span>{{ item.executionStatus }}</span>
            <span>{{ item.dataThrough }}</span>
          </div>
        </div>
      </section>

      <section class="pool-notes">
        <strong>边界</strong>
        <span>动态权重只能调整同一状态内的诊断排序；候选状态和执行门禁由 canonical 查询固定。</span>
      </section>
    </template>
  </main>
</template>

<style scoped>
.pool-page {
  min-height: 100vh;
  padding: 24px;
  background: #f7f9f7;
  color: #172019;
  font:
    14px/1.6 system-ui,
    sans-serif;
}
.pool-header,
.pool-summary,
.pool-group,
.agent-review,
.pool-notes {
  border: 1px solid #d8e0da;
  border-radius: 12px;
  background: #fff;
}
.pool-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
  padding: 18px;
}
.pool-header p,
h1,
h2 {
  margin: 0;
}
.pool-header p {
  color: #147a52;
  font-size: 12px;
  font-weight: 800;
}
.pool-header a {
  color: #2469a9;
  font-weight: 700;
}
.pool-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  margin-top: 16px;
  overflow: hidden;
}
.pool-summary article {
  padding: 14px;
  border-right: 1px solid #e4e9e5;
}
.pool-summary span,
.pool-summary strong {
  display: block;
}
.pool-summary span {
  color: #647169;
  font-size: 12px;
}
.pool-summary strong {
  margin-top: 4px;
  font-size: 20px;
}
.agent-review {
  margin-top: 16px;
  padding: 16px;
  border-left: 5px solid #147a52;
}
.agent-review p {
  margin: 5px 0 0;
}
.pool-group {
  margin-top: 16px;
  overflow: hidden;
}
.pool-group > header {
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e9e5;
}
.pool-table {
  overflow-x: auto;
}
.pool-row {
  display: grid;
  grid-template-columns: 2fr repeat(4, 1fr);
  min-width: 720px;
  padding: 10px 14px;
  border-top: 1px solid #eef1ef;
  align-items: center;
}
.pool-head {
  color: #647169;
  font-size: 12px;
  font-weight: 800;
}
.pool-row small {
  display: block;
  color: #647169;
}
.empty {
  padding: 22px;
  text-align: center;
  color: #647169;
}
.pool-notes {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding: 14px;
  background: #fff9eb;
}
.pool-state {
  margin-top: 16px;
  padding: 20px;
}
.pool-error {
  color: #a33530;
}
@media (max-width: 760px) {
  .pool-summary {
    grid-template-columns: repeat(2, 1fr);
  }
  .pool-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
