<script setup>
import { computed, onMounted, ref } from 'vue'

const emit = defineEmits(['back'])

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
    <div class="pool-wrap">
      <nav class="pool-topbar">
        <a href="./" class="pool-back" @click.prevent="emit('back')">← Market Lab 工作台</a>
        <a href="/recommended-pool/index.html" class="pool-ext">打开完整可配置报告 →</a>
      </nav>

      <header class="pool-header">
        <div>
          <p>A股筛选 · 严格门禁</p>
          <h1>A股研究门禁报告</h1>
        </div>
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
          <p class="agent-eyebrow">Agent 复核结论</p>
          <h2>
            {{ pool.agentReview.status === 'reviewed' ? `${pool.agentReview.agent.name} 已复核` : '待 Agent 复核' }}
          </h2>
          <p>{{ pool.agentReview.conclusion?.summary ?? pool.agentReview.message }}</p>
        </section>

        <section v-for="group in groups" :key="group.status" class="pool-group">
          <header>
            <h2>{{ group.status }}</h2>
            <span>{{ group.items.length }} / {{ group.total }}</span>
          </header>
          <p v-if="!group.items.length" class="empty">本轮无标的进入该状态</p>
          <div v-if="group.items.length" class="pool-table">
            <div class="pool-row pool-head">
              <span>标的</span><span>诊断分</span><span>状态</span><span>执行</span><span>数据截止</span>
            </div>
            <div v-for="item in group.items" :key="item.symbol" class="pool-row">
              <span>
                <b>{{ item.label }}</b>
                <small>{{ item.symbol }} · {{ item.market }}</small>
              </span>
              <span class="mono">{{ formatNumber(item.score, 0) }}</span>
              <span>{{ item.candidateStatus }}</span>
              <span class="mono">{{ item.executionStatus }}</span>
              <span class="mono">{{ item.dataThrough }}</span>
            </div>
          </div>
        </section>

        <section class="pool-notes">
          <strong>口径说明</strong>
          <span>完整报告支持按权重与阈值重算复核分层；候选状态和执行门禁由 canonical 查询固定。</span>
        </section>
      </template>
    </div>
  </main>
</template>

<style scoped>
.pool-page {
  min-height: 100vh;
  padding: 20px clamp(14px, 3vw, 40px) 48px;
  background: var(--bg);
  color: var(--ink);
}
.pool-wrap {
  max-width: 1200px;
  margin: 0 auto;
  display: grid;
  gap: 14px;
}
.pool-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
  font-size: 0.78rem;
}
.pool-back {
  color: var(--green);
  font-weight: 600;
  text-decoration: none;
}
.pool-ext {
  color: var(--blue);
  font-weight: 600;
  text-decoration: none;
}
.pool-header h1,
.agent-review h2,
.pool-group h2 {
  margin: 0;
}
.pool-header p {
  margin: 0 0 4px;
  color: var(--green);
  font-size: 0.72rem;
  font-weight: 600;
}
.pool-header h1 {
  font-size: clamp(1.35rem, 2.5vw, 1.85rem);
  letter-spacing: -0.02em;
}
.pool-summary,
.pool-group,
.agent-review,
.pool-notes,
.pool-state {
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--panel);
}
.pool-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  overflow: hidden;
}
.pool-summary article {
  padding: 12px 14px;
  border-right: 1px solid var(--line);
}
.pool-summary article:last-child {
  border-right: none;
}
.pool-summary span {
  display: block;
  color: var(--muted);
  font-size: 0.7rem;
}
.pool-summary strong {
  display: block;
  margin-top: 4px;
  font-family: var(--mono);
  font-size: 1.2rem;
}
.agent-review {
  padding: 14px 16px;
  border-left: 3px solid var(--green);
}
.agent-eyebrow {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 600;
}
.agent-review p:last-child {
  margin: 6px 0 0;
  color: var(--ink-secondary);
  font-size: 0.82rem;
}
.pool-group {
  overflow: hidden;
}
.pool-group > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.pool-group > header h2 {
  font-size: 0.92rem;
}
.pool-group > header span {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--muted);
}
.pool-table {
  overflow-x: auto;
}
.pool-row {
  display: grid;
  grid-template-columns: 2fr repeat(4, 1fr);
  min-width: 680px;
  padding: 9px 14px;
  border-top: 1px solid var(--line);
  align-items: center;
  font-size: 0.8rem;
}
.pool-head {
  border-top: none;
  color: var(--muted);
  font-size: 0.7rem;
  font-weight: 600;
}
.pool-row small {
  display: block;
  font-family: var(--mono);
  font-size: 0.68rem;
  color: var(--muted);
}
.mono {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
.empty {
  margin: 0;
  padding: 18px;
  text-align: center;
  color: var(--muted);
  font-size: 0.78rem;
}
.pool-notes {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 11px 14px;
  background: var(--surface-alt);
  font-size: 0.76rem;
  color: var(--muted);
}
.pool-notes strong {
  color: var(--amber);
  flex-shrink: 0;
}
.pool-state {
  padding: 18px;
}
.pool-error {
  color: var(--red);
  background: var(--red-dim);
}
@media (max-width: 768px) {
  .pool-summary {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
