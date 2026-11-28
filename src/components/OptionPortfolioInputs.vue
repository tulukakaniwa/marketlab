<script setup>
import { computed, onMounted, watch } from 'vue'
import LpResearchScenarioInput from './LpResearchScenarioInput.vue'
import PathScenarioProjectionControl from './PathScenarioProjectionControl.vue'

const props = defineProps({
  input: { type: Object, required: true },
})

const emit = defineEmits(['set-path-scenario', 'set-lp-scenario-field', 'patch-input'])

const strategies = [
  { id: 'single', label: '单腿', hint: '单个 call / put' },
  { id: 'vertical', label: '价差', hint: '买一腿、卖一腿' },
  { id: 'straddle', label: '跨式', hint: '同 K 的 call + put' },
  { id: 'strangle', label: '宽跨', hint: '低 K put + 高 K call' },
  { id: 'collar', label: '领口', hint: '保护 put + 备兑 call' },
]

const optionTypes = [
  { id: 'put', label: 'Put' },
  { id: 'call', label: 'Call' },
]

const sides = [
  { id: 'long', label: '买入' },
  { id: 'short', label: '卖出' },
]

const strategy = computed(() => props.input.optionStrategy || 'single')
const needsType = computed(() => ['single', 'vertical'].includes(strategy.value))
const needsSide = computed(() => strategy.value !== 'collar')
const needsSecondStrike = computed(() => ['vertical', 'strangle', 'collar'].includes(strategy.value))
const secondStrikeLabel = computed(() => {
  if (strategy.value === 'vertical') return '远端行权价'
  if (strategy.value === 'collar') return '卖购行权价'
  return '高行权价'
})

const widthPercentValue = computed(() => toPercent(props.input.optionWidthPct))
const rfrPercentValue = computed(() => toPercent(props.input.riskFreeRate))
const premiumValue = computed(() => optionalFinite(props.input.optionPremium) ?? '')
const feeIncomeValue = computed(() => optionalFinite(props.input.feeIncomeQuote) ?? '')

const summary = computed(() => {
  const side = props.input.optionSide === 'short' ? '卖出' : '买入'
  const type = props.input.optionType === 'call' ? 'Call' : 'Put'
  const k1 = fmt(props.input.strikePrice)
  const k2 = fmt(props.input.strikePrice2)
  if (strategy.value === 'vertical') return `${side} ${type} 价差：${k1} / ${k2}`
  if (strategy.value === 'straddle') return `${side}跨式：Call + Put @ ${k1}`
  if (strategy.value === 'strangle') return `${side}宽跨：Put ${k1} + Call ${k2}`
  if (strategy.value === 'collar') return `领口：买 Put ${k1} + 卖 Call ${k2}`
  return `${side} ${type} @ ${k1}`
})

onMounted(() => ensureOptionDefaults())
watch(
  () => props.input.entryPrice,
  () => ensureOptionDefaults(),
)

function buildStrikesPatch({
  nextStrategy = strategy.value,
  nextType = props.input.optionType,
  nextWidth = positive(props.input.optionWidthPct) ?? 0.05,
  resetPrimary = false,
} = {}) {
  const entry = positive(props.input.entryPrice)
  if (!entry) return {}
  if (nextStrategy === 'strangle' || nextStrategy === 'collar') {
    return {
      ...(resetPrimary ? { strikePrice: round(entry * (1 - nextWidth)) } : {}),
      strikePrice2: round(entry * (1 + nextWidth)),
    }
  }
  if (nextStrategy === 'vertical') {
    const k1 = positive(props.input.strikePrice) ?? entry
    const sign = nextType === 'call' ? 1 : -1
    return { strikePrice2: round(k1 * (1 + sign * nextWidth)) }
  }
  return {}
}

function setStrategy(id) {
  emit('patch-input', {
    optionStrategy: id,
    ...buildStrikesPatch({ nextStrategy: id, resetPrimary: true }),
  })
}

function setOptionType(id) {
  emit('patch-input', {
    optionType: id,
    ...(strategy.value === 'vertical' ? buildStrikesPatch({ nextType: id, resetPrimary: true }) : {}),
  })
}

function setSide(id) {
  emit('patch-input', { optionSide: id })
}

function useAtm() {
  const entry = positive(props.input.entryPrice)
  if (!entry) return
  emit('patch-input', {
    strikePrice: round(entry),
    ...buildStrikesPatch({ resetPrimary: true }),
  })
}

function setWidth(value) {
  emit('patch-input', {
    optionWidthPct: value,
    ...buildStrikesPatch({ nextWidth: value, resetPrimary: true }),
  })
}

function onWidthInput(raw) {
  const nextWidth = fromPercent(raw, 5)
  emit('patch-input', {
    optionWidthPct: nextWidth,
    ...buildStrikesPatch({ nextWidth }),
  })
}

function onRfrInput(raw) {
  emit('patch-input', { riskFreeRate: fromPercent(raw, 4) })
}

function onOptionalNonNegative(field, raw) {
  const next = optionalFinite(raw)
  emit('patch-input', { [field]: next !== null && next >= 0 ? next : null })
}

function onPositiveField(field, raw, fallback) {
  const next = positive(raw)
  emit('patch-input', { [field]: next ?? fallback })
}

function onOptionalPositiveInt(field, raw) {
  const next = positive(raw)
  emit('patch-input', { [field]: next ? Math.round(next) : null })
}

function ensureOptionDefaults() {
  const patch = {}
  const nextStrategy = ['single', 'vertical', 'straddle', 'strangle', 'collar'].includes(props.input.optionStrategy)
    ? props.input.optionStrategy
    : 'single'
  if (nextStrategy !== props.input.optionStrategy) patch.optionStrategy = nextStrategy
  if (!['put', 'call'].includes(props.input.optionType)) patch.optionType = 'put'
  if (!['long', 'short'].includes(props.input.optionSide)) patch.optionSide = 'long'
  if (!positive(props.input.optionQuantity)) patch.optionQuantity = 1
  if (!positive(props.input.optionMultiplier)) patch.optionMultiplier = 1
  if (!positive(props.input.optionWidthPct)) patch.optionWidthPct = 0.05
  if (!nonNegative(props.input.riskFreeRate)) patch.riskFreeRate = 0.04
  if (!positive(props.input.strikePrice) && positive(props.input.entryPrice)) {
    patch.strikePrice = round(props.input.entryPrice)
  }
  if (['vertical', 'strangle', 'collar'].includes(nextStrategy) && !positive(props.input.strikePrice2)) {
    Object.assign(patch, buildStrikesPatch({ nextStrategy, resetPrimary: true }))
  }
  if (Object.keys(patch).length) emit('patch-input', patch)
}

function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function nonNegative(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function round(value) {
  return Number(value.toFixed(2))
}

function toPercent(value) {
  return Number.isFinite(value) ? Number((value * 100).toFixed(2)) : 0
}

function fromPercent(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n / 100 : fallback / 100
}

function fmt(value) {
  return Number.isFinite(Number(value))
    ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value))
    : '—'
}
</script>

<template>
  <div class="opi-card">
    <div class="opi-head">
      <div>
        <span>研究层</span>
        <strong>期权组合</strong>
      </div>
      <small>不写入模拟挂单</small>
    </div>

    <div class="opi-strategies" role="group" aria-label="期权组合">
      <button
        v-for="item in strategies"
        :key="item.id"
        type="button"
        :class="{ active: strategy === item.id }"
        :title="item.hint"
        @click="setStrategy(item.id)"
      >
        {{ item.label }}
      </button>
    </div>

    <div class="opi-summary">
      <b>{{ summary }}</b>
      <span>仅用于组合敏感度、到期损益和 LP payoff 对照；期限必须独立输入，不能复用持仓恢复周期。</span>
    </div>

    <div class="opi-controls">
      <div v-if="needsType" class="opi-segment">
        <button
          v-for="item in optionTypes"
          :key="item.id"
          type="button"
          :class="{ active: input.optionType === item.id }"
          @click="setOptionType(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
      <div v-if="needsSide" class="opi-segment">
        <button
          v-for="item in sides"
          :key="item.id"
          type="button"
          :class="{ active: input.optionSide === item.id }"
          @click="setSide(item.id)"
        >
          {{ item.label }}
        </button>
      </div>
      <button type="button" class="opi-ghost" @click="useAtm">ATM</button>
    </div>

    <div class="opi-grid">
      <label>
        <span>{{ strategy === 'strangle' || strategy === 'collar' ? '低行权价' : '行权价' }}</span>
        <input
          :value="input.strikePrice"
          type="number"
          step="0.01"
          @input="onPositiveField('strikePrice', $event.target.value, 0)"
        />
      </label>
      <label v-if="needsSecondStrike">
        <span>{{ secondStrikeLabel }}</span>
        <input
          :value="input.strikePrice2"
          type="number"
          step="0.01"
          @input="onPositiveField('strikePrice2', $event.target.value, 0)"
        />
      </label>
      <label>
        <span>数量</span>
        <input
          :value="input.optionQuantity"
          type="number"
          min="0.0001"
          step="1"
          @input="onPositiveField('optionQuantity', $event.target.value, 1)"
        />
      </label>
      <label>
        <span>乘数</span>
        <input
          :value="input.optionMultiplier"
          type="number"
          min="0.0001"
          step="1"
          @input="onPositiveField('optionMultiplier', $event.target.value, 1)"
        />
      </label>
      <label>
        <span>距到期交易会话</span>
        <input
          :value="input.optionTenorSessions ?? ''"
          type="number"
          min="1"
          step="1"
          placeholder="必填"
          @input="onOptionalPositiveInt('optionTenorSessions', $event.target.value)"
        />
      </label>
    </div>

    <PathScenarioProjectionControl
      :enabled="input.pathUsesScenarioInputs === true"
      @change="(value) => emit('set-path-scenario', value)"
    />

    <details class="opi-advanced">
      <summary>高级输入</summary>
      <div class="opi-grid">
        <label>
          <span>首腿权利金</span>
          <input
            :value="premiumValue"
            type="number"
            min="0"
            step="0.01"
            placeholder="模型估算"
            @input="onOptionalNonNegative('optionPremium', $event.target.value)"
          />
        </label>
        <label>
          <span>无风险利率%</span>
          <input :value="rfrPercentValue" type="number" step="0.1" @input="onRfrInput($event.target.value)" />
        </label>
        <label>
          <span>区间宽度%</span>
          <input
            :value="widthPercentValue"
            type="number"
            min="0.1"
            step="0.5"
            @input="onWidthInput($event.target.value)"
          />
        </label>
        <label>
          <span>同周期路径手续费（报价币）</span>
          <input
            :value="feeIncomeValue"
            type="number"
            min="0"
            step="0.01"
            placeholder="必填；无费用填 0"
            @input="onOptionalNonNegative('feeIncomeQuote', $event.target.value)"
          />
        </label>
      </div>
      <div class="opi-widths">
        <button type="button" @click="setWidth(0.03)">3%</button>
        <button type="button" @click="setWidth(0.05)">5%</button>
        <button type="button" @click="setWidth(0.1)">10%</button>
      </div>

      <LpResearchScenarioInput :input="input" @change="(field, value) => emit('set-lp-scenario-field', field, value)" />
    </details>
  </div>
</template>

<style src="../styles/option-portfolio-inputs.css"></style>
