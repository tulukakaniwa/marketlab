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

const emit = defineEmits(['set-profile', 'set-auto-profile', 'center-input-change', 'patch-input'])

function nonNegativeNum(raw) {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

const reasonText = computed(() => {
  const decision = props.graph?.decision
  const market = props.market
  if (!decision || !market) return decision?.path || '载入 K 线后生成事实状态'
  return summarizeReason({
    state: decision.state,
    costDistance: market.costDistance,
    atrPercent: market.atrPercent,
    side: decision.timing?.side,
  })
})

const ordersTitle = computed(() => (props.graph?.decision?.timing?.side === 'sell' ? '模拟卖出单' : '模拟买入单'))
const checklist = computed(() => buildTraderChecklist({ graph: props.graph, market: props.market }))
const primaryOrders = computed(() => props.graph?.plan?.primaryOrders ?? [])
const orderReview = computed(() => buildOrderPlanReviewPresentation(props.graph))
const extremenessText = computed(() => `偏离极端度 ${Math.round((props.graph?.decision?.signalStrength ?? 0) * 100)}%`)

const factMeta = computed(() => {
  const decision = props.graph?.decision
  if (!decision) return '等待数据'
  const execution = decision.executionStatus === 'simulation-only' ? '仅模拟' : '不可执行'
  return `${decision.state} · 候选${decision.candidateStatus ?? '等待'} · ${execution}`
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
  if (triggered) return `${triggered} 已触发`
  if (blocked) return `${blocked} 未触发`
  return '等待'
})

const accountMeta = computed(() => {
  const capital = Math.max(Number(props.input?.capital) || 0, 0)
  const base = Math.max(Number(props.input?.baseNotional) || 0, 0)
  if (capital > 0 && base > 0) return '资金+底仓'
  if (capital > 0) return '仅现金'
  if (base > 0) return '仅底仓'
  return '缺输入'
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
      <div class="dd-tier-label">核心执行态 · {{ accountMeta }}</div>
      <article class="dd-context-card">
        <header>
          <strong>{{ sourceLabel }}</strong>
          <em>{{ rows.length }} K · {{ observationDate || rows.at(-1)?.date || '—' }}</em>
        </header>
        <div class="dd-context-grid">
          <div>
            <span>现价</span><strong>{{ money(market?.markPrice) }}</strong>
          </div>
          <div>
            <span>成本锚</span><strong>{{ money(market?.costAnchor) }}</strong>
          </div>
          <div>
            <span>偏离</span><strong>{{ pct(market?.costDistance) }}</strong>
          </div>
        </div>
        <div class="dd-account-inputs">
          <label>
            <span>账户资金</span>
            <input
              :value="input.capital"
              type="number"
              min="0"
              step="100"
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
              @input="emit('patch-input', { baseNotional: nonNegativeNum($event.target.value) })"
            />
          </label>
        </div>
      </article>

      <DisclosureSection title="行情状态" :meta="factMeta">
        <article class="dd-action-card">
          <header>
            <strong>市场结构 · {{ graph?.decision?.state || '等待数据' }}</strong>
            <em title="正态参考下的偏离极端度，不是胜率">{{ extremenessText }}</em>
          </header>
          <div v-if="hasPositionFacts" class="dd-action-grid">
            <div>
              <span>模拟首笔</span><strong>{{ money(graph?.position?.firstNotional) }}</strong>
            </div>
            <div>
              <span>挂单价</span><strong>{{ money(primaryOrders[0]?.price) }}</strong>
            </div>
            <div>
              <span>失效</span><strong>{{ money(graph?.position?.stopPrice) }}</strong>
            </div>
            <div>
              <span>目标</span><strong>{{ money(graph?.position?.targetPrice) }}</strong>
            </div>
            <div>
              <span>模拟风险预算</span><strong>{{ money(graph?.position?.riskBudget) }}</strong>
            </div>
            <div>
              <span>失效距离</span><strong>{{ pct(graph?.position?.stopDistance) }}</strong>
            </div>
          </div>
          <p v-if="hasPositionFacts" class="dd-empty-note">
            名义金额按正态参考极端度缩放，仅用于情景模拟，不是胜率或实盘仓位建议。
          </p>
          <p v-else class="dd-empty-note">
            未生成模拟挂单。当前只展示价格位置和触发状态，不显示名义、风险预算或目标价。
          </p>
        </article>
      </DisclosureSection>

      <DisclosureSection title="模拟挂单" :meta="`${primaryOrders.length} 档`" :default-open="primaryOrders.length > 0">
        <OrderTable :title="ordersTitle" :orders="primaryOrders" />
      </DisclosureSection>
    </div>

    <div class="dd-tier-group">
      <div class="dd-tier-label">门禁与复核依据</div>

      <DisclosureSection title="信号条件" :meta="triggerMeta" :default-open="false" storage-key="decision.triggers">
        <div v-for="item in orderReview.conditions" :key="`${orderReview.mode}-${item}`" class="dd-risk-row">
          <span>{{ orderReview.label }}</span>
          <strong>{{ item }}</strong>
        </div>
        <div v-for="item in graph?.decision?.triggeredConditions ?? []" :key="item" class="dd-risk-row">
          <span>已触发</span>
          <strong>{{ formatFormulaBlockReason(item) }}</strong>
        </div>
        <div v-for="item in graph?.decision?.blockedReasons ?? []" :key="item" class="dd-risk-row">
          <span>未触发</span>
          <strong>{{ formatFormulaBlockReason(item) }}</strong>
        </div>
      </DisclosureSection>

      <DisclosureSection
        title="检查项"
        :meta="checklist.items?.length ? `${checklist.items.length} 项` : '等待'"
        :default-open="false"
        storage-key="decision.checklist"
      >
        <TraderChecklist :checklist="checklist" :show-header="false" :open-groups="['entry']" />
      </DisclosureSection>

      <DisclosureSection title="状态摘要" :default-open="false" storage-key="decision.reason" tone="muted">
        <p class="dd-reason-text">{{ reasonText }}</p>
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
