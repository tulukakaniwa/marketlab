<script setup>
defineProps({ state: { type: Object, required: true } })
defineEmits(['show-on-chart'])
</script>

<template>
  <section class="research-market-preview">
    <template v-if="state.phase === 'ready'">
      <strong>ETH/USDT · {{ state.report.source.timeframe }} · {{ state.report.rows.length }} 根已收盘 K 线</strong>
      <span>{{ state.report.rows[0]?.date }} → {{ state.report.rows.at(-1)?.date }}</span>
      <span>Binance 公共行情 · UTC · 历史回填 · 未审计历史修订</span>
      <button type="button" @click="$emit('show-on-chart')">查看对齐主图</button>
    </template>
    <template v-else>
      <strong>导入时间覆盖研究样本的真实行情</strong>
      <span>支持 ETH/USDT 已收盘 5 分钟或 1 小时行情包。</span>
      <span>按每根 K 线收盘时间判断研究快照是否已知。</span>
    </template>
  </section>
</template>

<style scoped>
.research-market-preview {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 24px 18px;
  min-height: 200px;
  font-size: 12px;
}
.research-market-preview span {
  color: var(--muted);
}
.research-market-preview button {
  padding: 8px 12px;
  border: 1px solid var(--green);
  border-radius: 4px;
  color: var(--ink);
  background: var(--panel);
  cursor: pointer;
}
</style>
