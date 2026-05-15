<script setup>
import { computed } from 'vue'
import { summarizeReason } from '../domain/decision/narrative.js'
import { buildTraderChecklist } from '../domain/workbench/traderChecklist.js'
import DisclosureSection from './DisclosureSection.vue'
import OrderTable from './OrderTable.vue'
import ReplayPanel from './ReplayPanel.vue'
import TraderChecklist from './TraderChecklist.vue'

const props = defineProps({
  graph: { type: Object, required: true },
  market: { type: Object, default: null },
  replay: { type: Object, required: true },
  profileReplays: { type: Array, default: () => [] },
  activeProfileId: { type: String, default: 'balanced' },
  autoProfile: { type: Boolean, default: false },
  replayEnabled: { type: Boolean, default: false },
  portfolioEnabled: { type: Boolean, default: false },
  profileList: { type: Array, required: true },
})

const emit = defineEmits(['set-profile', 'set-auto-profile'])

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

const ordersTitle = computed(() =>
  props.graph?.decision?.timing?.side === 'sell' ? '候选卖出条件' : '候选买入条件'
)

const checklist = computed(() => buildTraderChecklist({ graph: props.graph, market: props.market }))
const primaryOrders = computed(() => props.graph?.plan?.primaryOrders ?? [])
const matchText = computed(() => `匹配 ${Math.round((props.graph?.decision?.signalStrength ?? 0) * 100)}%`)
const factMeta = computed(() => props.graph?.decision?.state || '等待数据')
const hasPositionFacts = computed(() => [
  props.graph?.position?.firstNotional,
  primaryOrders.value[0]?.price,
  props.graph?.position?.stopPrice,
  props.graph?.position?.targetPrice,
  props.graph?.position?.riskBudget,
  props.graph?.position?.stopDistance,
].some(Number.isFinite))
const triggerMeta = computed(() => {
  const triggered = props.graph?.decision?.triggeredConditions?.length ?? 0
  const blocked = props.graph?.decision?.blockedReasons?.length ?? 0
  if (triggered) return `${triggered} 已触发`
  if (blocked) return `${blocked} 未触发`
  return '等待'
})
const replayMeta = computed(() => props.replayEnabled ? `${props.replay?.tradeCount ?? 0} 次` : '未启用')

function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' }
</script>

<template>
  <div class="dd-drawer">
    <DisclosureSection title="当前事实" :meta="`${factMeta} · ${matchText}`" storage-key="decision.facts">
      <article class="dd-action-card">
        <header>
          <strong>{{ graph?.decision?.state || '等待数据' }}</strong>
          <em>{{ matchText }}</em>
        </header>
        <div v-if="hasPositionFacts" class="dd-action-grid">
          <div><span>候选首笔</span><strong>{{ money(graph?.position?.firstNotional) }}</strong></div>
          <div><span>候选价</span><strong>{{ money(primaryOrders[0]?.price) }}</strong></div>
          <div><span>失效</span><strong>{{ money(graph?.position?.stopPrice) }}</strong></div>
          <div><span>目标</span><strong>{{ money(graph?.position?.targetPrice) }}</strong></div>
          <div><span>风险预算</span><strong>{{ money(graph?.position?.riskBudget) }}</strong></div>
          <div><span>失效距离</span><strong>{{ pct(graph?.position?.stopDistance) }}</strong></div>
        </div>
        <p v-else class="dd-empty-note">未生成候选计划。当前只展示价格位置和触发状态，不显示名义、风险预算或目标价。</p>
      </article>
    </DisclosureSection>

    <DisclosureSection title="触发条件" :meta="triggerMeta" storage-key="decision.triggers">
      <div class="dd-risk-row">
        <span>失效线</span>
        <strong>{{ money(graph?.plan?.invalidation?.lower) }} / {{ money(graph?.plan?.invalidation?.upper) }}</strong>
      </div>
      <div v-for="item in graph?.decision?.triggeredConditions ?? []" :key="item" class="dd-risk-row">
        <span>已触发</span>
        <strong>{{ item }}</strong>
      </div>
      <div v-for="item in graph?.decision?.blockedReasons ?? []" :key="item" class="dd-risk-row">
        <span>未触发</span>
        <strong>{{ item }}</strong>
      </div>
    </DisclosureSection>

    <DisclosureSection title="计划单" :meta="`${primaryOrders.length} 档`" :default-open="primaryOrders.length > 0">
      <OrderTable :title="ordersTitle" :orders="primaryOrders" />
    </DisclosureSection>

    <DisclosureSection title="交易员检查单" :meta="checklist.items?.length ? `${checklist.items.length} 项` : '等待'" storage-key="decision.checklist">
      <TraderChecklist :checklist="checklist" :show-header="false" :open-groups="['entry']" />
    </DisclosureSection>

    <DisclosureSection v-if="portfolioEnabled" title="组合研究" :default-open="false" storage-key="decision.portfolio" tone="research">
      <div v-if="portfolioEnabled" class="dd-risk-row">
        <span>组合研究</span>
        <strong :class="(graph?.portfolio ?? 0) >= 0 ? 'green' : 'red'">{{ money(graph?.portfolio) }}</strong>
      </div>
    </DisclosureSection>

    <DisclosureSection title="Profile" :meta="autoProfile ? '回放辅助' : activeProfileId" :default-open="false" storage-key="decision.profile" tone="muted">
      <div class="dd-profile-tabs">
        <button :class="{ active: autoProfile }" :disabled="!replayEnabled" @click="emit('set-auto-profile', true)">回放辅助</button>
        <button
          v-for="p in profileList"
          :key="p.id"
          :class="{ active: !autoProfile && activeProfileId === p.id }"
          @click="emit('set-profile', p.id)"
        >{{ p.label }}</button>
      </div>
      <p v-if="!replayEnabled" class="replay-empty">ReplayAccount 未启用。Profile 只使用手动选择，不由回放反向改写默认条件。</p>
      <ul v-else class="dd-profile-grid">
        <li v-for="item in profileReplays" :key="item.profile.id" :class="{ active: item.profile.id === activeProfileId }">
          <span>{{ item.profile.label }}</span>
          <strong>{{ pct(item.replay.returnOnUsedNotional) }}</strong>
          <em>回撤 {{ money(item.replay.maxDrawdown) }} · {{ item.replay.tradeCount }} 次</em>
        </li>
      </ul>
    </DisclosureSection>

    <DisclosureSection v-if="replayEnabled" title="回放历史" :meta="replayMeta" :default-open="false" storage-key="decision.replay" tone="muted">
      <ReplayPanel :replay="replay" :profile-replays="profileReplays" :active-profile-id="activeProfileId" />
    </DisclosureSection>

    <DisclosureSection title="解读" :default-open="false" storage-key="decision.reason" tone="muted">
      <p class="dd-reason-text">{{ reasonText }}</p>
    </DisclosureSection>
  </div>
</template>

<style>
.dd-drawer { display: grid; gap: 0; min-width: 0; }
.dd-drawer > * { min-width: 0; }
.dd-reason-text { margin: 0; font-size: 0.95rem; line-height: 1.5; color: var(--ink); overflow-wrap: anywhere; }
.dd-action-card { padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-alt); min-width: 0; }
.dd-action-card header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; flex-wrap: wrap; }
.dd-action-card header strong { font-size: 1rem; }
.dd-action-card header em { font-style: normal; color: var(--muted); font-size: 0.72rem; padding: 1px 7px; border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; }
.dd-action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.dd-action-grid div { display: grid; gap: 1px; min-width: 0; }
.dd-action-grid span { color: var(--muted); font-size: 0.6rem; font-weight: 800; text-transform: uppercase; }
.dd-action-grid strong { font-size: 0.84rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dd-empty-note { margin: 0; color: var(--muted); font-size: 0.72rem; line-height: 1.45; }
.dd-risk-row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); min-width: 0; }
.dd-risk-row span { color: var(--muted); font-size: 0.66rem; font-weight: 800; text-transform: uppercase; flex-shrink: 0; }
.dd-risk-row strong { font-size: 0.82rem; font-variant-numeric: tabular-nums; text-align: right; overflow-wrap: anywhere; }
.dd-risk-row strong.green { color: var(--green); }
.dd-risk-row strong.red { color: var(--red); }
.dd-profile-tabs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; }
.dd-profile-tabs button { min-width: 0; min-height: 28px; padding: 3px 4px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-size: 0.7rem; font-weight: 700; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dd-profile-tabs button.active { border-color: var(--green); background: var(--surface-active); }
.dd-profile-grid { display: grid; gap: 4px; padding: 0; margin: 0; list-style: none; }
.dd-profile-grid li { display: grid; grid-template-columns: minmax(40px, auto) 1fr minmax(0, 1.4fr); gap: 6px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); font-size: 0.72rem; align-items: baseline; min-width: 0; }
.dd-profile-grid li.active { border-color: var(--green); background: var(--surface-active); }
.dd-profile-grid span { color: var(--muted); font-weight: 800; }
.dd-profile-grid strong { font-variant-numeric: tabular-nums; }
.dd-profile-grid em { font-style: normal; color: var(--muted); font-size: 0.64rem; overflow-wrap: anywhere; }
</style>
