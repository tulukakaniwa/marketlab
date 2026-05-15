<script setup>
import { computed } from 'vue'

const props = defineProps({
  input: { type: Object, required: true },
  profileList: { type: Array, required: true },
  graph: { type: Object, default: null },
})

const FIELDS = [
  { key: 'strategyEdgeSigma', label: '入场偏离σ', min: 0.1, max: 3, step: 0.05, hint: '成本偏离 / ATR' },
  { key: 'strategyMomentumSigma', label: '动量阈值σ', min: -2, max: 2, step: 0.05, hint: '5日动量 / 日波动' },
  { key: 'strategyCostSlopeSigma', label: '成本下行σ', min: 0, max: 3, step: 0.05, hint: '成本斜率 / ATR' },
  { key: 'strategyRiskPct', label: '风险预算%', min: 0.1, max: 8, step: 0.1, pct: true, hint: '权益 × 风险预算' },
  { key: 'strategyExposurePct', label: '仓位上限%', min: 1, max: 100, step: 1, pct: true, hint: '权益 × 仓位上限' },
  { key: 'strategyFirstWeight', label: '首笔比例%', min: 5, max: 100, step: 1, pct: true, hint: '最大名义 × 首笔' },
  { key: 'strategyCooldownFactor', label: '冷却系数', min: 0.25, max: 8, step: 0.25, hint: '买/卖冷却天数' },
  { key: 'strategyTakeProfitSigma', label: '止盈 ATR', min: 0.1, max: 5, step: 0.1, hint: 'ATR × 止盈系数' },
  { key: 'strategyCutLossSigma', label: '风控 ATR', min: 0.1, max: 5, step: 0.1, hint: 'ATR × 风控系数' },
]

const formulaLinks = computed(() => {
  const graph = props.graph
  const p = graph?.profile ?? {}
  const pos = graph?.position ?? {}
  const band = graph?.deltaBands?.long
  return [
    ['GetDelta 价格带', band ? `${fmt(band.low)} / ${fmt(band.cost)} / ${fmt(band.high)}` : '等待市场样本'],
    ['入场阈值', `max(ATR × ${f2(p.edgeAtr)}, 0.5%) = ${pct(p.minEdge)}`],
    ['动量确认', `5日动量 > ${pct(p.momentumMin)}`],
    ['成本止跌', `成本斜率 ≥ -${pct(p.costSlopeMin)}`],
    ['风险预算', `权益 × ${pct(p.riskMax)} = ${fmt(pos.riskBudget)}`],
    ['仓位上限', `权益 × ${pct(p.exposureMax)} → 最大名义 ${fmt(pos.maxNotional)}`],
    ['首笔挂单', `最大名义 × ${pct(p.firstWeight)} = ${fmt(pos.firstNotional)}`],
    ['止盈/风控', `止盈 ${pct(p.takeProfitMin)}；风控动量 ${pct(p.cutMomentumMin)}`],
    ['冷却', `买 ${p.buyCooldown ?? '—'} 天；卖 ${p.sellCooldown ?? '—'} 天`],
  ]
})

function valueOf(input, field) {
  const value = Number(input[field.key])
  if (!Number.isFinite(value)) return ''
  return field.pct ? Number((value * 100).toFixed(2)) : value
}

function setValue(input, field, raw) {
  const value = Number(raw)
  if (!Number.isFinite(value)) return
  const normalized = field.pct ? value / 100 : value
  input[field.key] = Math.min(field.max / (field.pct ? 100 : 1), Math.max(field.min / (field.pct ? 100 : 1), normalized))
}

function fmt(value) {
  if (!Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value)
}

function pct(value) {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(2)}%`
}

function f2(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : '—'
}
</script>

<template>
  <section class="strategy-profile-inputs">
    <div class="spi-head">
      <strong>策略档位</strong>
      <select v-model="input.strategyProfile">
        <option v-for="profile in profileList" :key="profile.id" :value="profile.id">{{ profile.label }}</option>
      </select>
    </div>

    <div v-if="input.strategyProfile === 'custom'" class="spi-grid">
      <label v-for="field in FIELDS" :key="field.key">
        <span>{{ field.label }}</span>
        <input
          type="number"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value="valueOf(input, field)"
          @input="setValue(input, field, $event.target.value)"
        />
        <small>{{ field.hint }}</small>
      </label>
    </div>
    <p v-else>当前使用预设档位。选择“自定义”后，可调整入场、仓位、止盈、风控和冷却参数。</p>

    <div class="spi-links">
      <header>
        <span>公式联动</span>
        <strong>GetDelta + 成本带 + 账户权益</strong>
      </header>
      <dl>
        <template v-for="row in formulaLinks" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[1] }}</dd>
        </template>
      </dl>
    </div>
  </section>
</template>

<style>
.strategy-profile-inputs { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-alt); }
.spi-head { display: grid; grid-template-columns: 1fr minmax(100px, 0.7fr); gap: 8px; align-items: center; }
.spi-head strong { color: var(--green); font-size: 0.78rem; }
.spi-head select,
.spi-grid input { min-width: 0; min-height: 30px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); padding: 3px 7px; font-variant-numeric: tabular-nums; }
.spi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.spi-grid label { display: grid; gap: 3px; min-width: 0; }
.spi-grid span { color: var(--muted); font-size: 0.64rem; font-weight: 800; }
.spi-grid small { color: var(--muted); font-size: 0.58rem; line-height: 1.25; overflow-wrap: anywhere; }
.strategy-profile-inputs p { margin: 0; color: var(--muted); font-size: 0.68rem; line-height: 1.45; }
.spi-links { display: grid; gap: 6px; padding-top: 8px; border-top: 1px solid var(--line); }
.spi-links header { display: flex; gap: 8px; justify-content: space-between; align-items: baseline; }
.spi-links header span { color: var(--green); font-size: 0.62rem; font-weight: 900; }
.spi-links header strong { color: var(--muted); font-size: 0.62rem; text-align: right; }
.spi-links dl { display: grid; grid-template-columns: minmax(74px, 0.55fr) 1fr; gap: 4px 8px; margin: 0; font-size: 0.66rem; }
.spi-links dt { color: var(--muted); font-weight: 800; }
.spi-links dd { margin: 0; color: var(--ink); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
</style>
