<script setup>
defineProps({
  strategyId: { type: String, default: 'off' },
  catalog: { type: Array, default: () => [] },
  strategy: { type: Object, default: null },
  ready: { type: Boolean, default: true },
})

const emit = defineEmits(['select'])

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(digits)}%`
}

function signedPct(value, digits = 1) {
  if (!Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(digits)}%`
}

function pf(value) {
  if (value === Infinity) return '∞'
  return Number.isFinite(value) ? value.toFixed(2) : '—'
}

function price(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) : '—'
}
</script>

<template>
  <div v-if="catalog.length" class="chart-strategy-bar" role="region" aria-label="图表盈利策略控制台">
    <div class="csb-modes">
      <span class="csb-title">算法策略</span>
      <button
        v-for="item in catalog"
        :key="item.id"
        type="button"
        class="csb-mode-btn"
        :class="{ active: strategyId === item.id }"
        :disabled="!ready"
        :title="item.role"
        @click="emit('select', item.id)"
      >
        {{ item.shortLabel }}
      </button>
    </div>

    <div v-if="strategy?.active && strategy.summary" class="csb-telemetry">
      <span class="csb-stat">
        <b>笔数</b><strong>{{ strategy.summary.closedCount }}</strong>
      </span>
      <span class="csb-stat">
        <b>胜率</b><strong>{{ pct(strategy.summary.winRate, 0) }}</strong>
      </span>
      <span class="csb-stat">
        <b>累计净值</b>
        <strong :class="strategy.summary.totalNetReturn >= 0 ? 'green' : 'red'">
          {{ signedPct(strategy.summary.totalNetReturn) }}
        </strong>
      </span>
      <span class="csb-stat">
        <b>盈亏比</b><strong>{{ pf(strategy.summary.profitFactor) }}</strong>
      </span>
      <span class="csb-stat">
        <b>最大回撤</b><strong class="red">{{ pct(strategy.summary.maxDrawdown) }}</strong>
      </span>

      <span v-if="strategy.activePosition" class="csb-live-pill is-open">
        持仓 {{ strategy.activePosition.legLabel }} · 防守 {{ price(strategy.activePosition.stopPrice) }} → 目标
        {{ price(strategy.activePosition.targetPrice) }} ({{ signedPct(strategy.activePosition.unrealizedNetReturn) }})
      </span>
      <span v-else-if="strategy.latestSignal" class="csb-live-pill is-signal">
        今日信号 {{ strategy.latestSignal.legLabel }} · 次日开盘验证
      </span>
      <span v-else class="csb-live-pill">空仓等待门禁</span>
    </div>
  </div>
</template>

<style>
.chart-strategy-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px 12px;
  padding: 4px 10px;
  border-top: 1px solid var(--line);
  background: var(--surface-alt);
}
.csb-modes {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-wrap: wrap;
}
.csb-title {
  color: var(--muted);
  font-size: 0.68rem;
  font-weight: 700;
  margin-right: 3px;
}
.csb-mode-btn {
  min-height: 22px;
  padding: 2px 8px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--muted);
  font-size: 0.71rem;
  font-weight: 600;
  white-space: nowrap;
}
.csb-mode-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--ink);
}
.csb-mode-btn.active {
  border-color: color-mix(in srgb, var(--green) 46%, transparent);
  background: var(--green-dim);
  color: var(--green);
}
.csb-telemetry {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  font-size: 0.7rem;
}
.csb-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}
.csb-stat b {
  color: var(--muted);
  font-size: 0.64rem;
  font-weight: 600;
}
.csb-stat strong {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  color: var(--ink);
}
.csb-stat strong.green {
  color: var(--green);
}
.csb-stat strong.red {
  color: var(--red);
}
.csb-live-pill {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--bg);
  color: var(--muted);
  font-family: var(--mono);
  font-size: 0.65rem;
  font-variant-numeric: tabular-nums;
}
.csb-live-pill.is-open {
  border-color: color-mix(in srgb, var(--green) 42%, transparent);
  background: var(--green-dim);
  color: var(--green);
}
.csb-live-pill.is-signal {
  border-color: color-mix(in srgb, var(--blue) 45%, transparent);
  background: var(--blue-dim);
  color: var(--blue);
}
</style>
