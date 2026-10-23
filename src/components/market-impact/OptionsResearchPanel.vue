<script setup>
import { computed } from 'vue'
import { number, signed, timestamp } from './format.js'
const props = defineProps({ report: { type: Object, required: true }, scenario: { type: Object, required: true } })
const emit = defineEmits(['scenario'])
const origin = computed(() => {
  if (props.report.dataOrigin === 'synthetic-fixture') {
    return {
      count: '合成测试成交',
      eyebrow: 'SYNTHETIC FIXTURE / TEST BASKET',
      title: '合成测试成交与快照',
      status: '合成样本',
    }
  }
  if (props.report.dataOrigin === 'observed') {
    return {
      count: '观测成交',
      eyebrow: 'OBSERVED / RECENT TRADE BASKET',
      title: '真实成交与捕获时快照',
      status: '观测数据',
    }
  }
  return {
    count: '来源未确认成交',
    eyebrow: 'SOURCE UNCONFIRMED',
    title: '来源未确认的成交与快照',
    status: '来源未确认',
  }
})
const executionLabel = {
  complete: '完整成交',
  partial: '盘口内部分成交',
  'no-hedge': '无需对冲',
  blocked: '盘口不可计算',
}
const scenarioLabel = { disabled: '默认关闭', ready: '假设已启用', blocked: '情景不可用' }
function numeric(key, event) {
  emit('scenario', { [key]: event.target.value === '' ? NaN : Number(event.target.value) })
}
</script>

<template>
  <section class="metrics-strip" aria-label="期权数据摘要">
    <div>
      <span>{{ origin.count }}</span
      ><strong>{{ report.summary?.tradeCount ?? '—' }} <small>笔</small></strong>
    </div>
    <div>
      <span>覆盖合约</span><strong>{{ report.summary?.tickerCount ?? '—' }} <small>ticker</small></strong>
    </div>
    <div>
      <span>已覆盖 OI <small>按合约去重</small></span
      ><strong>{{ number(report.summary?.coveredOpenInterestEth, 1) }} <small>ETH</small></strong>
    </div>
    <div>
      <span>捕获最大时间差</span><strong>{{ number(report.summary?.snapshotSkewMs, 0) }} <small>ms</small></strong>
    </div>
  </section>
  <div class="options-workspace">
    <section class="observations-pane">
      <div class="section-heading">
        <div>
          <span class="eyebrow">{{ origin.eyebrow }}</span>
          <h2>{{ origin.title }}</h2>
        </div>
        <span
          class="state-tag"
          :data-state="
            report.status === 'partial' || !['observed', 'synthetic-fixture'].includes(report.dataOrigin)
              ? 'blocked'
              : 'ready'
          "
          >{{ origin.status }} · {{ report.status === 'partial' ? '部分覆盖' : '可计算' }}</span
        >
      </div>
      <div class="action-meta">
        <span>捕获于 {{ timestamp(report.summary?.collectedAt) }}</span
        ><span>合约 OI 不代表做市商净持仓</span>
      </div>
      <div class="observations-table-wrap">
        <table class="observations-table">
          <thead>
            <tr>
              <th>合约 / 方向</th>
              <th>成交量<br /><small>ETH</small></th>
              <th>IV 成交 / mark<br /><small>%</small></th>
              <th>合约 OI<br /><small>ETH</small></th>
              <th>模型 Δ<br /><small>捕获时</small></th>
              <th>UTC 时间<br /><small>trade / ticker</small></th>
              <th>质量</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in report.tradeRows" :key="row.id">
              <td>
                <strong class="instrument-name">{{ row.instrumentName }}</strong
                ><span class="trade-side" :data-side="row.takerSide">{{
                  row.takerSide === 'buy' ? '主动买入' : row.takerSide === 'sell' ? '主动卖出' : '方向缺失'
                }}</span>
              </td>
              <td>{{ number(row.amountEth, 2) }}</td>
              <td>{{ number(row.tradeIvPct, 1) }} / {{ number(row.markIvPct, 1) }}</td>
              <td>{{ number(row.openInterestEth, 1) }}</td>
              <td>{{ signed(row.bsDelta, 4) }}</td>
              <td class="time-cell">
                <span>{{ timestamp(row.tradeTime) }}</span
                ><span>{{ timestamp(row.tickerTime) }}</span>
              </td>
              <td>
                <span :class="row.quality === 'ready' ? 'good-text' : 'amber'">{{
                  { ready: '可计算', missing: '缺数据', invalid: '无效' }[row.quality] || row.quality
                }}</span>
                <details v-if="row.issues?.length">
                  <summary>原因</summary>
                  <span v-for="issue in row.issues" :key="issue">{{ issue }}</span>
                </details>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!report.tradeRows?.length" class="empty-inline">该研究包没有成交记录。</p>
      <div class="pane-footnote">成交 IV 与捕获时 mark IV 分列。模型 Δ 是捕获时重估，不是成交发生时的已知 Delta。</div>
    </section>
    <aside class="scenario-pane">
      <div class="section-heading">
        <div>
          <span class="eyebrow">EXPLICIT SCENARIO</span>
          <h2>增量对冲假设</h2>
        </div>
      </div>
      <label class="scenario-toggle"
        ><input
          type="checkbox"
          :checked="scenario.enabled"
          @change="emit('scenario', { enabled: $event.target.checked })"
        /><span>假设被动对手为本批成交增量对冲<small>不代表已观察到的对冲行为</small></span></label
      >
      <div class="scenario-fields">
        <label
          >对冲比例 <small>0–1</small
          ><input
            type="number"
            min="0"
            max="1"
            step="0.1"
            :value="scenario.hedgeRatio"
            :disabled="!scenario.enabled"
            @change="numeric('hedgeRatio', $event)" /></label
        ><label
          >已对冲 <small>ETH · 买入为正</small
          ><input
            type="number"
            step="0.1"
            :value="scenario.alreadyHedgedEth"
            :disabled="!scenario.enabled"
            @change="numeric('alreadyHedgedEth', $event)"
        /></label>
      </div>
      <span class="state-tag scenario-status" :data-state="report.scenario?.status === 'ready' ? 'ready' : 'idle'">{{
        scenarioLabel[report.scenario?.status] || report.scenario?.status
      }}</span>
      <template v-if="report.scenario?.status === 'ready'">
        <div class="scenario-demand">
          <span>条件对冲需求</span><strong>{{ signed(report.scenario.desiredHedgeEth, 4) }} <small>ETH</small></strong
          ><span class="muted small">正数买入 · 负数卖出</span>
        </div>
        <span
          class="state-tag"
          :data-state="
            report.scenario.execution?.status === 'partial' || report.scenario.execution?.status === 'blocked'
              ? 'blocked'
              : 'ready'
          "
          >{{ executionLabel[report.scenario.execution?.status] || '不可计算' }}</span
        >
        <dl class="execution-details">
          <div>
            <dt>盘口</dt>
            <dd>ETH-PERPETUAL</dd>
          </div>
          <div>
            <dt>盘口时点</dt>
            <dd>{{ timestamp(report.scenario.execution?.bookTimestamp) }}</dd>
          </div>
          <div>
            <dt>条件成交</dt>
            <dd>{{ number(report.scenario.execution?.filledEth, 4) }} ETH</dd>
          </div>
          <div>
            <dt>未成交</dt>
            <dd :class="{ amber: report.scenario.execution?.unfilledEth > 0 }">
              {{ number(report.scenario.execution?.unfilledEth, 4) }} ETH
            </dd>
          </div>
          <div>
            <dt>平均价</dt>
            <dd>{{ number(report.scenario.execution?.averagePriceUsd, 2) }} USD</dd>
          </div>
          <div>
            <dt>平均冲击</dt>
            <dd>{{ signed(report.scenario.execution?.averageImpactBps) }} bps</dd>
          </div>
          <div>
            <dt>成交名义</dt>
            <dd>{{ number(report.scenario.execution?.usdNotional, 2) }} USD</dd>
          </div>
        </dl>
        <div class="scenario-disclaimer">连续深度估计 · 不含手续费<br />USD 合约名义，不是 USD 现金支出</div>
      </template>
      <div v-else-if="report.scenario?.status === 'disabled'" class="scenario-off">
        <span class="off-icon" aria-hidden="true">○</span><strong>情景未启用</strong>
        <p>当前只展示导入数据。</p>
      </div>
      <div v-if="report.scenario?.issues?.length" class="scenario-issues" role="status">
        <span v-for="issue in report.scenario.issues" :key="issue">{{ issue }}</span>
      </div>
      <details class="unknowns">
        <summary>仍然未知的市场事实</summary>
        <ul>
          <li>被动对手身份与初始库存</li>
          <li>成交属于开仓还是平仓</li>
          <li>是否、何时、在哪里实际对冲</li>
        </ul>
      </details>
    </aside>
  </div>
  <footer class="evidence-footer">
    <span>可用时间 {{ timestamp(report.summary?.availableAt) }}</span
    ><span>不与 LP 数据跨时刻拼接 · 不推断做市商净 Gamma</span>
  </footer>
</template>
