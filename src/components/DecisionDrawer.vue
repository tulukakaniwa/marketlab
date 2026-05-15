<script setup>
import { computed } from 'vue'
import { summarizeReason } from '../domain/decision/narrative.js'
import { buildTraderChecklist } from '../domain/workbench/traderChecklist.js'
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

function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' }
</script>

<template>
  <div class="dd-drawer">
    <section class="dd-section dd-reason">
      <h3 class="dd-h">解读</h3>
      <p class="dd-reason-text">{{ reasonText }}</p>
    </section>

    <section class="dd-section dd-action">
      <h3 class="dd-h">当前事实</h3>
      <article class="dd-action-card">
        <header>
          <strong>{{ graph?.decision?.state || '等待数据' }}</strong>
          <em>条件匹配 {{ Math.round((graph?.decision?.signalStrength ?? 0) * 100) }}%</em>
        </header>
        <div class="dd-action-grid">
          <div><span>候选首笔</span><strong>{{ money(graph?.position?.firstNotional) }}</strong></div>
          <div><span>候选价</span><strong>{{ money(graph?.plan?.primaryOrders?.[0]?.price) }}</strong></div>
          <div><span>失效</span><strong>{{ money(graph?.position?.stopPrice) }}</strong></div>
          <div><span>目标</span><strong>{{ money(graph?.position?.targetPrice) }}</strong></div>
          <div><span>风险预算</span><strong>{{ money(graph?.position?.riskBudget) }}</strong></div>
          <div><span>失效距离</span><strong>{{ pct(graph?.position?.stopDistance) }}</strong></div>
        </div>
      </article>
    </section>

    <section class="dd-section">
      <TraderChecklist :checklist="checklist" />
    </section>

    <section class="dd-section">
      <h3 class="dd-h">计划单</h3>
      <OrderTable :title="ordersTitle" :orders="graph?.plan?.primaryOrders ?? []" />
    </section>

    <section class="dd-section">
      <h3 class="dd-h">触发条件</h3>
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
      <div v-if="portfolioEnabled" class="dd-risk-row">
        <span>组合研究</span>
        <strong :class="(graph?.portfolio ?? 0) >= 0 ? 'green' : 'red'">{{ money(graph?.portfolio) }}</strong>
      </div>
    </section>

    <section class="dd-section">
      <h3 class="dd-h">Profile</h3>
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
    </section>

    <section v-if="replayEnabled" class="dd-section">
      <h3 class="dd-h">回放历史</h3>
      <ReplayPanel :replay="replay" :profile-replays="profileReplays" :active-profile-id="activeProfileId" />
    </section>
  </div>
</template>

<style>
.dd-drawer { display: grid; gap: 16px; min-width: 0; }
.dd-drawer > * { min-width: 0; }
.dd-section { display: grid; gap: 8px; padding-bottom: 12px; border-bottom: 1px solid var(--line); min-width: 0; }
.dd-section:last-child { border-bottom: none; }
.dd-h { margin: 0; color: var(--green); font-size: 0.66rem; font-weight: 900; letter-spacing: 0.06em; text-transform: uppercase; }
.dd-reason-text { margin: 0; font-size: 0.95rem; line-height: 1.5; color: var(--ink); overflow-wrap: anywhere; }
.dd-action-card { padding: 10px 12px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface-alt); min-width: 0; }
.dd-action-card header { display: flex; gap: 8px; align-items: baseline; margin-bottom: 8px; flex-wrap: wrap; }
.dd-action-card header strong { font-size: 1rem; }
.dd-action-card header em { font-style: normal; color: var(--muted); font-size: 0.72rem; padding: 1px 7px; border: 1px solid var(--line); border-radius: 999px; white-space: nowrap; }
.dd-action-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.dd-action-grid div { display: grid; gap: 1px; min-width: 0; }
.dd-action-grid span { color: var(--muted); font-size: 0.6rem; font-weight: 800; text-transform: uppercase; }
.dd-action-grid strong { font-size: 0.84rem; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
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
