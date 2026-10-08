<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { presentMarketCenters } from '../domain/workbench/marketCenterPresentation.js'

const props = defineProps({
  snapshot: { type: Object, default: null },
  queryState: { type: Object, default: null },
  config: { type: Object, default: () => ({}) },
  sourceKey: { type: String, default: '' },
  nativeSettings: { type: Boolean, default: false },
})
const emit = defineEmits(['center-input-change'])
const cards = computed(() => presentMarketCenters(props.snapshot, props.queryState, props.config))
const fileError = ref('')
const observation = computed(() => props.snapshot?.asOfDate ?? props.queryState?.asOfDate ?? '')
let importTicket = 0
watch(
  () => [props.sourceKey, observation.value],
  () => {
    importTicket++
    fileError.value = ''
  },
  { flush: 'sync' },
)
onBeforeUnmount(() => {
  importTicket++
})
const fields = {
  statisticalCenter: [
    ['lookback', '窗口 · 会话'],
    ['minObservations', '最低样本 · 会话'],
  ],
  vwapCost: [
    ['lookback', '窗口 · 会话'],
    ['amountPerVolumeToPrice', '成交额/量 → 价格系数'],
  ],
  supplyDemand: [
    ['a', '需求截距 a'],
    ['b', '需求斜率 b'],
    ['c', '供给截距 c'],
    ['d', '供给斜率 d'],
  ],
  fundamental: [
    ['nextDividend', '预期下期每单位股息 D₁'],
    ['requiredReturn', '年要求收益 r · 比例'],
    ['growthRate', '年增长 g · 比例'],
  ],
}
function command(formula, key, value) {
  if (formula === 'cohortCost' && key === 'document') importTicket++
  emit('center-input-change', { formula, key, value, sourceKey: props.sourceKey })
}
async function importFloat(event) {
  const file = event.target.files?.[0]
  const sourceKey = props.sourceKey
  const date = observation.value
  if (!file) return
  const ticket = ++importTicket
  fileError.value = ''
  try {
    const value = await file.text()
    if (ticket === importTicket && sourceKey === props.sourceKey && date === observation.value)
      emit('center-input-change', { formula: 'cohortCost', key: 'document', value, sourceKey })
  } catch {
    if (ticket === importTicket) fileError.value = '文件读取失败'
  } finally {
    event.target.value = ''
  }
}
function number(value, digits = 2) {
  return Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: digits }).format(value) : '—'
}
function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}
</script>

<template>
  <section class="market-centers" aria-label="独立中枢公式">
    <div class="center-source">
      <span>截至 {{ snapshot?.asOfDate || queryState?.asOfDate || '—' }}</span>
      <span>研究公式 · 不改写计划</span>
    </div>
    <p v-if="queryState?.status === 'error'" role="status">计算失败，请检查输入</p>
    <article v-for="card in cards" :key="card.id" class="center-card" :data-formula="card.id">
      <header>
        <strong>{{ card.label }}</strong
        ><span :class="{ 'center-ready': card.hasValue }">{{ card.stateLabel }}</span>
      </header>
      <div class="center-value">
        <b>{{ number(card.value) }}</b
        ><small>{{ card.claimLabel }}</small>
      </div>
      <small class="center-relation">{{ card.relation }}</small>
      <p v-if="card.hasValue && card.value === 0" class="center-note">零估值不进入对数价格图</p>
      <div v-if="card.id === 'statisticalCenter' && card.formula?.autoregression" class="center-metrics">
        <span>φ {{ number(card.formula.autoregression.phi, 4) }}</span>
        <span>DF {{ number(card.formula.unitRootTest?.statistic, 3) }}</span>
        <span v-if="card.formula.residualTest">LB p {{ number(card.formula.residualTest.pValue, 3) }}</span>
        <span>半衰 {{ number(card.formula.halfLifeSessions, 1) }} 会话</span>
        <span v-if="card.formula.response === 'oscillating-decay'">振荡衰减</span>
      </div>
      <p v-if="card.id === 'statisticalCenter'" class="center-note">
        固定窗 · 常数项 · DF lag 0 · LB lag 5 · 条件统计估计
      </p>
      <p v-if="card.modelHint" class="center-note">{{ card.modelHint }}</p>
      <p v-if="card.id === 'vwapCost'" class="center-note">
        {{
          card.formula?.source?.kind === 'amount-volume'
            ? card.hasValue
              ? '成交额 / 成交量 · 已声明单位换算'
              : '成交额 / 成交量 · 需完整成交额及单位换算'
            : 'HLC3 × 成交量代理 · 非实际持仓成本'
        }}
      </p>
      <p v-if="card.id === 'cohortCost'" class="center-note">随机换手假设 · 非实际持仓成本</p>
      <p v-if="card.inputHint" class="center-note" role="status">{{ card.inputHint }}</p>
      <div v-if="card.id === 'cohortCost' && card.hasValue" class="center-metrics">
        <span>假设覆盖 {{ percent(card.formula.coverage) }}</span>
        <span>初始成本未知 {{ percent(card.formula.unknownFraction) }}</span>
      </div>
      <details v-if="fields[card.id] || card.id === 'cohortCost'" class="center-settings">
        <summary>{{ ['supplyDemand', 'fundamental'].includes(card.id) ? '情景输入' : '公式参数' }}</summary>
        <label v-if="!nativeSettings && ['supplyDemand', 'fundamental'].includes(card.id)" class="center-enable">
          <input
            type="checkbox"
            :checked="config[card.id]?.enabled"
            @change="command(card.id, 'enabled', $event.target.checked)"
          />启用显式情景
        </label>
        <p v-if="nativeSettings && fields[card.id]" class="center-note">在图表 Indicators 中选择公式并设置参数</p>
        <div v-if="fields[card.id] && !nativeSettings" class="center-fields">
          <label v-for="[key, label] in fields[card.id]" :key="key">
            <span>{{ label }}</span>
            <input
              type="number"
              :aria-label="`${card.label} ${label}`"
              step="any"
              :value="config[card.id]?.[key] ?? ''"
              @change="command(card.id, key, $event.target.value)"
            />
          </label>
        </div>
        <template v-if="['supplyDemand', 'fundamental'].includes(card.id)">
          <p class="center-note">仅当前观察日 · 价格与标的一致 · 比例 1 = 100%</p>
          <p v-if="card.id === 'supplyDemand'" class="center-note">a/c：数量/会话 · b/d：数量/价格/会话</p>
          <p v-else class="center-note">预期下一年每单位分红 · 恒定增长 · 要求 r &gt; g</p>
          <button type="button" @click="command(card.id, 'apply', true)">按当前日计算</button>
        </template>
        <template v-if="card.id === 'cohortCost'">
          <label class="center-file"
            >导入流通股本 JSON<input
              type="file"
              accept=".json,application/json"
              aria-label="导入流通股本 JSON"
              @change="importFloat"
          /></label>
          <p v-if="config.cohortCost?.importError" role="status">{{ config.cohortCost.importError }}</p>
          <p v-if="fileError" role="status">{{ fileError }}</p>
          <button v-if="config.cohortCost?.freeFloat" type="button" @click="command('cohortCost', 'document', '')">
            清除流通股本
          </button>
          <details class="center-schema">
            <summary>JSON 字段模板</summary>
            <small>替换来源、日期、数值；补齐窗口内每个有成交日</small>
            <pre>
{
  "unit": "shares",
  "volumeUnit": "reported-volume",
  "volumeToShares": "填写数值",
  "provenance": {
    "kind": "observed", "source": "实际来源",
    "asOfDate": "YYYY-MM-DD",
    "availableAt": "YYYY-MM-DD:close"
  },
  "observations": [{
    "date": "YYYY-MM-DD", "value": "填写股数",
    "provenance": {
      "kind": "observed", "source": "实际来源",
      "asOfDate": "YYYY-MM-DD",
      "availableAt": "YYYY-MM-DD:close"
    }
  }]
}</pre
            >
          </details>
        </template>
      </details>
    </article>
  </section>
</template>

<style src="../styles/market-centers.css"></style>
