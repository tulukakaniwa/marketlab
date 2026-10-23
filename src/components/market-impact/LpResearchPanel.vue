<script setup>
import ImpactComparisonChart from './ImpactComparisonChart.vue'
import { compactRaw, number, quoteStatus, signed, timestamp } from './format.js'
defineProps({
  report: { type: Object, required: true },
  selected: { type: Number, default: 0 },
  action: { type: Object, default: null },
})
const emit = defineEmits(['select'])
</script>

<template>
  <section class="metrics-strip" aria-label="LP 采集摘要">
    <div>
      <span>动作记录</span
      ><strong
        >{{ report.counts?.Mint ?? '—' }} <small>Mint</small> <b class="metric-separator">/</b>
        {{ report.counts?.Burn ?? '—' }} <small>Burn</small></strong
      >
    </div>
    <div>
      <span>交易 / 领取</span
      ><strong
        >{{ report.counts?.Swap ?? '—' }} <small>Swap</small> <b class="metric-separator">/</b>
        {{ report.counts?.Collect ?? '—' }} <small>Collect</small></strong
      >
    </div>
    <div>
      <span>块范围</span
      ><strong class="medium-number"
        >{{ report.window?.seedBlock?.number }} → {{ report.window?.endBlock?.number }}</strong
      >
    </div>
    <div>
      <span>数据资格</span
      ><strong class="medium-number">{{
        report.dataOrigin === 'synthetic-fixture' ? '合成测试样本' : 'RPC 内部一致'
      }}</strong
      ><small>非收据证明</small>
    </div>
  </section>
  <div class="lp-workspace">
    <section class="event-pane">
      <div class="section-heading">
        <h2>流动性动作</h2>
        <span class="counter">{{ report.actions?.length ?? 0 }}</span>
      </div>
      <div class="event-table-wrap">
        <table class="event-table">
          <thead>
            <tr>
              <th>区块 / 动作</th>
              <th>ΔL <span class="muted">raw</span></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(item, index) in report.actions"
              :key="`${item.event.blockNumber}:${item.event.logIndex}`"
              :class="{ selected: selected === index }"
            >
              <td>
                <button
                  class="event-select"
                  :aria-pressed="selected === index"
                  :aria-label="`选择 ${item.event.type} 区块 ${item.event.blockNumber} 日志 ${item.event.logIndex}`"
                  @click="emit('select', index)"
                >
                  <span class="event-kind" :data-type="item.event.type">{{ item.event.type }}</span
                  ><span class="mono">{{ item.event.blockNumber }}</span
                  ><small>log {{ item.event.logIndex }}</small>
                </button>
              </td>
              <td class="mono" :title="item.event.liquidityDeltaRaw">{{ compactRaw(item.event.liquidityDeltaRaw) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="!report.actions?.length" class="empty-inline">该窗口内没有 Mint / Burn。</p>
      </div>
      <div class="pane-footnote">UTC · 按区块 / 日志顺序<br />Collect 不视为撤资卖压</div>
    </section>
    <section class="analysis-pane">
      <template v-if="action">
        <div class="section-heading">
          <div>
            <span class="eyebrow">ACTION / {{ action.event.type.toUpperCase() }}</span>
            <h2>动作前后，承接同一笔订单</h2>
          </div>
          <span class="state-tag" data-state="ready"
            >池价{{ action.priceMovedByLiquidityAction ? '发生变化' : '未改变' }}</span
          >
        </div>
        <div class="action-meta">
          <span>{{ timestamp(action.event.eventTime) }}</span
          ><span>tick {{ action.event.tickLower }} → {{ action.event.tickUpper }}</span
          ><span>手续费 {{ report.pool.feePips }} pips</span>
        </div>
        <div class="liquidity-ribbon">
          <span>活跃 L <small>raw</small></span
          ><strong :title="action.activeLiquidityBeforeRaw">{{ compactRaw(action.activeLiquidityBeforeRaw) }}</strong
          ><span class="arrow">→</span
          ><strong :title="action.activeLiquidityAfterRaw">{{ compactRaw(action.activeLiquidityAfterRaw) }}</strong
          ><span class="muted small">协议流动性单位</span>
        </div>
        <ImpactComparisonChart :action="action" />
        <div class="quote-grid">
          <section
            v-for="(trade, key) in { buyBase: action.buyBase, sellBase: action.sellBase }"
            :key="key"
            class="quote-block"
          >
            <div class="quote-heading">
              <h3>{{ key === 'buyBase' ? '买入 WETH' : '卖出 WETH' }}</h3>
              <span>{{ key === 'buyBase' ? '5,000 USDC 输入' : '1 WETH 输入' }}</span>
            </div>
            <table class="comparison-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>动作前</th>
                  <th>动作后</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>平均价 <small>USDC/WETH</small></td>
                  <td>{{ number(trade.before.averageExecutionPrice) }}</td>
                  <td>{{ number(trade.after.averageExecutionPrice) }}</td>
                </tr>
                <tr>
                  <td>边际冲击 <small>bps</small></td>
                  <td>{{ signed(trade.before.marginalImpactBps) }}</td>
                  <td>{{ signed(trade.after.marginalImpactBps) }}</td>
                </tr>
                <tr>
                  <td>成交范围</td>
                  <td :class="{ amber: trade.before.status === 'partial' }">{{ quoteStatus(trade.before.status) }}</td>
                  <td :class="{ amber: trade.after.status === 'partial' }">{{ quoteStatus(trade.after.status) }}</td>
                </tr>
                <tr v-if="trade.before.status === 'partial' || trade.after.status === 'partial'">
                  <td>未成交 <small>raw</small></td>
                  <td :title="trade.before.unfilledAmountInRaw">{{ compactRaw(trade.before.unfilledAmountInRaw) }}</td>
                  <td :title="trade.after.unfilledAmountInRaw">{{ compactRaw(trade.after.unfilledAmountInRaw) }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>
      </template>
      <div v-else class="empty-analysis">
        <span class="eyebrow">NO LIQUIDITY ACTIONS</span>
        <h2>当前窗口没有可比较动作</h2>
        <p>换一个包含 Mint / Burn 的本地研究包。</p>
      </div>
    </section>
  </div>
  <footer class="evidence-footer">
    <span>捕获于 {{ timestamp(report.fetchedAt) }}</span
    ><span>仅该池 / 已捕获 tick 覆盖 · 不推断 ETH 全市场方向</span>
  </footer>
</template>
