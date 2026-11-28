<script setup>
import { computed } from 'vue'
import {
  STRATEGY_FIELD_GROUPS,
  formatStrategyFactor as f2,
  formatStrategyNumber as fmt,
  formatStrategyPct as pct,
  parseStrategyFieldValue,
  strategyFieldValue as valueOf,
} from './strategyProfileInputsModel.js'

const props = defineProps({
  input: { type: Object, required: true },
  profileList: { type: Array, required: true },
  graph: { type: Object, default: null },
})

const emit = defineEmits(['patch-input'])

function onFieldInput(field, raw) {
  const next = parseStrategyFieldValue(field, raw)
  if (next !== null) emit('patch-input', { [field.key]: next })
}

const executionLinks = computed(() => {
  const graph = props.graph
  const p = graph?.profile ?? {}
  const pos = graph?.position ?? {}
  const formulaRows = graph?.formulaStrategy?.executionParams ?? []
  const formulaHorizonSessions = Number(graph?.inputs?.formulaHorizonSessions)
  const horizonLabel =
    graph?.decision?.holdingWindow ??
    (Number.isFinite(formulaHorizonSessions)
      ? `${formulaHorizonSessions} 个交易会话（公式推导）`
      : '当前未形成方向周期')
  const deltaSlope = Number(graph?.inputs?.deltaSlope ?? props.input.deltaSlope)
  return [
    ...formulaRows,
    ['入场阈值', `max(ATR × ${f2(p.edgeAtr)}, 0.5%) = ${pct(p.minEdge)}`],
    ['动量确认', `自适应快动量 > ${pct(p.momentumMin)}`],
    ['成本止跌', `成本斜率 ≥ -${pct(p.costSlopeMin)}`],
    ['模拟风险预算', `权益 × ${pct(p.riskMax)} = ${fmt(pos.riskBudget)}`],
    ['模拟仓位上限', `权益 × ${pct(p.exposureMax)} → 最大名义 ${fmt(pos.maxNotional)}`],
    ['模拟首笔挂单', `最大名义 × ${pct(p.firstWeight)} = ${fmt(pos.firstNotional)}`],
    [
      '退出计划',
      `退出 ${pct(Number(props.input.exitTargetReturn) || 0)}；deltaSlope=${pct(deltaSlope)}；周期=${horizonLabel}；失效 ${fmt(pos.stopPrice)}`,
    ],
    ['风控确认', `动量破坏 < -${pct(p.cutMomentumMin)}`],
    ['冷却', `买 ${p.buyCooldown ?? '—'} 个会话；卖 ${p.sellCooldown ?? '—'} 个会话`],
  ]
})

const lifecycleSteps = computed(() => {
  const steps = props.graph?.formulaStrategy?.steps
  if (!Array.isArray(steps) || !steps.length) return []
  return steps.map((step, index) => ({
    index: String(index + 1),
    title: step.label,
    status: step.status,
    summary: step.role,
    rows: [
      ['公式', step.formula],
      ['输出', step.value],
    ],
  }))
})

const moduleLinks = computed(() => props.graph?.formulaStrategy?.researchOnly ?? [])
const formulaBasis = computed(() => props.graph?.formulaStrategy?.formulaBasis ?? null)

function implementationStatusLabel(status) {
  return (
    {
      implemented: '公式已实现',
      'research-only': '仅研究',
      'proxy-only': '代理模型',
      'protocol-unverified': '协议未验证',
    }[status] ?? '状态未标注'
  )
}
</script>

<template>
  <section class="strategy-profile-inputs">
    <div class="spi-head">
      <strong>自有公式策略组合</strong>
      <select :value="input.strategyProfile" @change="emit('patch-input', { strategyProfile: $event.target.value })">
        <option v-for="profile in profileList" :key="profile.id" :value="profile.id">{{ profile.label }}</option>
      </select>
    </div>

    <div class="spi-lifecycle">
      <article v-for="step in lifecycleSteps" :key="step.title" class="spi-step">
        <header>
          <span>{{ step.index }}</span>
          <strong>{{ step.title }}</strong>
          <b>{{ step.status }}</b>
        </header>
        <p>{{ step.summary }}</p>
        <dl>
          <template v-for="row in step.rows" :key="row[0]">
            <dt>{{ row[0] }}</dt>
            <dd>{{ row[1] }}</dd>
          </template>
        </dl>
      </article>
    </div>

    <div v-if="formulaBasis" class="spi-calibration">
      <span>公式口径</span>
      <strong>{{ formulaBasis.sourceId }} · {{ implementationStatusLabel(formulaBasis.status) }}</strong>
      <small>{{ formulaBasis.note }}</small>
      <dl>
        <template v-for="row in formulaBasis.variables" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[1] }} · {{ row[2] }}</dd>
        </template>
        <template v-for="row in formulaBasis.terms" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[2] }}</dd>
        </template>
      </dl>
    </div>

    <details class="spi-param-details" :open="input.strategyProfile === 'custom'">
      <summary>
        <span>参数调节</span>
        <strong>{{ input.strategyProfile === 'custom' ? '模拟档位可编辑' : '模拟档位只读' }}</strong>
      </summary>
      <div v-if="input.strategyProfile === 'custom'" class="spi-groups">
        <section v-for="group in STRATEGY_FIELD_GROUPS" :key="group.title">
          <h4>{{ group.title }}</h4>
          <div class="spi-grid">
            <label v-for="field in group.fields" :key="field.key">
              <span>{{ field.label }}</span>
              <input
                type="number"
                :min="field.min"
                :max="field.max"
                :step="field.step"
                :value="valueOf(input, field)"
                @input="onFieldInput(field, $event.target.value)"
              />
              <small>{{ field.hint }}</small>
            </label>
          </div>
        </section>
      </div>
      <p v-else>这些档位参数只负责过滤、情景仓位和冷却；不构成实盘仓位建议。</p>
    </details>

    <div class="spi-links">
      <header>
        <span>模拟档位明细</span>
        <strong>辅助公式链路，不是公式来源</strong>
      </header>
      <dl>
        <template v-for="row in executionLinks" :key="row[0]">
          <dt>{{ row[0] }}</dt>
          <dd>{{ row[1] }}</dd>
        </template>
      </dl>
    </div>

    <details class="spi-boundary">
      <summary>公式边界 / 研究层</summary>
      <div class="spi-modules">
        <article v-for="row in moduleLinks" :key="row[0]" :class="{ research: row[1] === '研究层' }">
          <strong>{{ row[0] }}</strong>
          <span>{{ row[1] }}</span>
          <small>{{ row[2] }}</small>
        </article>
      </div>
    </details>
  </section>
</template>

<style src="../styles/strategy-profile-inputs.css"></style>
