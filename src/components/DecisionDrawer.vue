<script setup>
import { computed } from 'vue'
import { summarizeReason } from '../domain/decision/narrative.js'
import { formatFormulaBlockReason } from '../domain/formula-research/formulaInputLabels.js'
import { buildOrderPlanReviewPresentation } from '../domain/formula-research/formulaPresentation.js'
import { buildTraderChecklist } from '../domain/workbench/traderChecklist.js'
import DisclosureSection from './DisclosureSection.vue'
import OrderTable from './OrderTable.vue'
import TraderChecklist from './TraderChecklist.vue'
import DecisionResearchSections from './DecisionResearchSections.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  sourceLabel: { type: String, default: '未载入' },
  rows: { type: Array, default: () => [] },
  allRows: { type: Array, default: () => [] },
  cursor: { type: Number, default: 0 },
  observationDate: { type: String, default: '' },
  replay: { type: Object, required: true },
  profileReplays: { type: Array, default: () => [] },
  activeProfileId: { type: String, default: 'balanced' },
  autoProfile: { type: Boolean, default: false },
  replayEnabled: { type: Boolean, default: false },
  portfolioEnabled: { type: Boolean, default: false },
  profileList: { type: Array, required: true },
  input: { type: Object, default: () => ({}) },
  centerConfig: { type: Object, default: () => ({}) },
  sourceKey: { type: String, default: '' },
  nativeCenterSettings: { type: Boolean, default: false },
})

const emit = defineEmits([
  'set-profile',
  'set-auto-profile',
  'center-input-change',
  'patch-input',
  'set-observation-date',
  'latest-observation',
])

function nonNegativeNum(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

const firstDate = computed(() => props.allRows[0]?.date ?? props.rows[0]?.date ?? '')
const lastDate = computed(() => props.allRows.at(-1)?.date ?? props.rows.at(-1)?.date ?? '')
const isAtLatest = computed(() => !props.allRows.length || props.cursor >= props.allRows.length - 1)

const reasonText = computed(() => {
  const decision = props.graph?.decision
  const market = props.market
  if (!decision || !market) return decision?.path || '载入 K 线后生成状态'
  return summarizeReason({
    state: decision.state,
    costDistance: market.costDistance,
    atrPercent: market.atrPercent,
    side: decision.timing?.side,
  })
})

const ordersTitle = computed(() => (props.graph?.decision?.timing?.side === 'sell' ? '卖出挂单梯度' : '买入挂单梯度'))
const checklist = computed(() => buildTraderChecklist({ graph: props.graph, market: props.market }))
const primaryOrders = computed(() => props.graph?.plan?.primaryOrders ?? [])
const orderReview = computed(() => buildOrderPlanReviewPresentation(props.graph))
const extremenessPct = computed(() => Math.round((props.graph?.decision?.signalStrength ?? 0) * 100))

const factMeta = computed(() => {
  const decision = props.graph?.decision
  if (!decision) return '等待数据'
  return `${decision.candidateStatus ?? '等待'} · ${decision.executionStatus === 'simulation-only' ? '模拟就绪' : '门禁拦截'}`
})

const hasPositionFacts = computed(() =>
  [
    props.graph?.position?.firstNotional,
    primaryOrders.value[0]?.price,
    props.graph?.position?.stopPrice,
    props.graph?.position?.targetPrice,
    props.graph?.position?.riskBudget,
    props.graph?.position?.stopDistance,
  ].some(Number.isFinite),
)

const triggerMeta = computed(() => {
  const triggered = props.graph?.decision?.triggeredConditions?.length ?? 0
  const blocked = props.graph?.decision?.blockedReasons?.length ?? 0
  if (triggered) return `${triggered} 满足`
  if (blocked) return `${blocked} 拦截`
  return '等待'
})

const accountMeta = computed(() => {
  const capital = Math.max(Number(props.input?.capital) || 0, 0)
  const base = Math.max(Number(props.input?.baseNotional) || 0, 0)
  if (capital > 0 && base > 0) return '现金+底仓'
  if (capital > 0) return '纯现金'
  if (base > 0) return '纯底仓'
  return '未设资金'
})

function money(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}
function pct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—'
}
</script>

<template>
  <div class="dd-drawer">
    <div class="dd-tier-group">
      <div class="dd-tier-label">
        <span>执行快照</span>
        <em>{{ accountMeta }}</em>
      </div>

      <article class="dd-context-card">
        <div class="dd-asof-bar">
          <span class="dd-asof-label">观察日</span>
          <input
            type="date"
            class="dd-asof-input"
            :value="observationDate || rows.at(-1)?.date || ''"
            :min="firstDate"
            :max="lastDate"
            :disabled="!rows.length"
            @input="emit('set-observation-date', $event.target.value)"
          />
          <button type="button" class="dd-asof-latest" :disabled="isAtLatest" @click="emit('latest-observation')">
            最新
          </button>
        </div>

        <div class="dd-context-grid">
          <div>
            <span>现价</span>
            <strong>{{ money(market?.markPrice) }}</strong>
          </div>
          <div>
            <span>成本锚</span>
            <strong>{{ money(market?.costAnchor) }}</strong>
          </div>
          <div>
            <span>锚偏离</span>
            <strong :class="{ green: (market?.costDistance ?? 0) >= 0, red: (market?.costDistance ?? 0) < 0 }">
              {{ pct(market?.costDistance) }}
            </strong>
          </div>
        </div>

        <div class="dd-account-inputs">
          <label>
            <span>可用现金</span>
            <input
              :value="input.capital"
              type="number"
              min="0"
              step="100"
              placeholder="0"
              @input="emit('patch-input', { capital: nonNegativeNum($event.target.value) })"
            />
          </label>
          <label>
            <span>底仓名义</span>
            <input
              :value="input.baseNotional"
              type="number"
              min="0"
              step="100"
              placeholder="0"
              @input="emit('patch-input', { baseNotional: nonNegativeNum($event.target.value) })"
            />
          </label>
        </div>
      </article>

      <article class="dd-action-card" :class="{ ready: hasPositionFacts }">
        <header>
          <div>
            <span class="dd-state-eyebrow">{{ factMeta }}</span>
            <strong>{{ graph?.decision?.state || '等待样本' }}</strong>
          </div>
          <em class="dd-extreme-pill">偏离度 {{ extremenessPct }}%</em>
        </header>

        <div v-if="hasPositionFacts" class="dd-action-grid">
          <div>
            <span>首笔名义</span><strong>{{ money(graph?.position?.firstNotional) }}</strong>
          </div>
          <div>
            <span>首档挂单</span><strong>{{ money(primaryOrders[0]?.price) }}</strong>
          </div>
          <div>
            <span>止损失效</span><strong class="red">{{ money(graph?.position?.stopPrice) }}</strong>
          </div>
          <div>
            <span>目标价位</span><strong class="green">{{ money(graph?.position?.targetPrice) }}</strong>
          </div>
          <div>
            <span>风险预算</span><strong>{{ money(graph?.position?.riskBudget) }}</strong>
          </div>
          <div>
            <span>止损距离</span><strong>{{ pct(graph?.position?.stopDistance) }}</strong>
          </div>
        </div>
        <p v-else class="dd-empty-note">{{ reasonText }}</p>
      </article>

      <DisclosureSection title="挂单梯度" :meta="`${primaryOrders.length} 档`" :default-open="primaryOrders.length > 0">
        <OrderTable :title="ordersTitle" :orders="primaryOrders" />
      </DisclosureSection>
    </div>

    <div class="dd-tier-group">
      <div class="dd-tier-label"><span>门禁复核</span></div>

      <DisclosureSection title="门禁明细" :meta="triggerMeta" :default-open="false" storage-key="decision.triggers">
        <div v-for="item in orderReview.conditions" :key="`${orderReview.mode}-${item}`" class="dd-risk-row">
          <span>{{ orderReview.label }}</span>
          <strong>{{ item }}</strong>
        </div>
        <div v-for="item in graph?.decision?.triggeredConditions ?? []" :key="item" class="dd-risk-row is-pass">
          <span>通过</span>
          <strong>{{ formatFormulaBlockReason(item) }}</strong>
        </div>
        <div v-for="item in graph?.decision?.blockedReasons ?? []" :key="item" class="dd-risk-row is-block">
          <span>拦截</span>
          <strong>{{ formatFormulaBlockReason(item) }}</strong>
        </div>
      </DisclosureSection>

      <DisclosureSection
        title="风控清单"
        :meta="checklist.items?.length ? `${checklist.items.length} 项` : '等待'"
        :default-open="false"
        storage-key="decision.checklist"
      >
        <TraderChecklist :checklist="checklist" :show-header="false" :open-groups="['entry']" />
      </DisclosureSection>
    </div>

    <DecisionResearchSections
      :graph="graph"
      :replay="replay"
      :profile-replays="profileReplays"
      :active-profile-id="activeProfileId"
      :auto-profile="autoProfile"
      :replay-enabled="replayEnabled"
      :portfolio-enabled="portfolioEnabled"
      :profile-list="profileList"
      :input="input"
      :center-config="centerConfig"
      :source-key="sourceKey"
      :native-center-settings="nativeCenterSettings"
      @center-input-change="emit('center-input-change', $event)"
      @patch-input="(patch) => emit('patch-input', patch)"
      @set-profile="(id) => emit('set-profile', id)"
      @set-auto-profile="(v) => emit('set-auto-profile', v)"
    />
  </div>
</template>

<style src="../styles/decision-drawer.css"></style>
