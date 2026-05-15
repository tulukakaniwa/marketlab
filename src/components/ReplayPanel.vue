<script setup>
defineProps({
  replay: { type: Object, required: true },
  profileReplays: { type: Array, default: () => [] },
  activeProfileId: { type: String, default: 'balanced' },
})

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
  <section class="replay-panel">
    <header>
      <span>日线回放</span>
      <strong>{{ money(replay.totalPnl) }}</strong>
      <small>{{ replay.status === 'disabled' ? '未启用' : replay.status === 'missing-account-input' ? '缺少账户输入' : (replay.range || '等待样本') }}</small>
    </header>
    <div class="replay-grid">
      <article>
        <span>执行</span>
        <strong>{{ replay.tradeCount }}</strong>
      </article>
      <article>
        <span>兑现胜率</span>
        <strong>{{ pct(replay.winRate) }}</strong>
      </article>
      <article>
        <span>账户回报</span>
        <strong>{{ pct(replay.returnOnUsedNotional) }}</strong>
      </article>
      <article>
        <span>回撤</span>
        <strong>{{ money(replay.maxDrawdown) }}</strong>
      </article>
      <article>
        <span>现金</span>
        <strong>{{ money(replay.cash) }}</strong>
      </article>
      <article>
        <span>持仓市值</span>
        <strong>{{ money(replay.openValue) }}</strong>
      </article>
    </div>
    <div v-if="profileReplays.length" class="profile-scan">
      <article
        v-for="item in profileReplays"
        :key="item.profile.id"
        :class="{ active: item.profile.id === activeProfileId }"
      >
        <span>{{ item.profile.label }}</span>
        <strong>{{ pct(item.replay.returnOnUsedNotional) }}</strong>
        <small>回撤 {{ money(item.replay.maxDrawdown) }} / {{ item.replay.tradeCount }} 次</small>
      </article>
    </div>
    <table v-if="replay.trades.length">
      <tbody>
        <tr v-for="trade in replay.trades.slice(-4).reverse()" :key="`${trade.signalDate}-${trade.fillDate}`">
          <td>{{ trade.side === 'buy' ? '买' : '卖' }}</td>
          <td>{{ trade.fillDate }}</td>
          <td>{{ trade.reason }}</td>
          <td :class="{ positive: trade.pnl > 0, negative: trade.pnl < 0 }">{{ money(trade.pnl) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="replay-empty">
      {{ replay.status === 'disabled' ? '回放旁路未启用。' : replay.status === 'missing-account-input' ? '需要账户资金或底仓名义后才运行回放。' : '当前样本没有形成回放成交。' }}
    </p>
  </section>
</template>
