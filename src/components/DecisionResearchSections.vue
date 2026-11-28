<script setup>
import { computed } from 'vue'
import DisclosureSection from './DisclosureSection.vue'
import ReplayPanel from './ReplayPanel.vue'
import CausalModelPanel from './CausalModelPanel.vue'
import MarketCentersPanel from './MarketCentersPanel.vue'

const props = defineProps({
  graph: { type: Object, required: true },
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

const activeProfileLabel = computed(
  () => props.profileList.find((p) => p.id === props.activeProfileId)?.label ?? props.activeProfileId,
)
const replayMeta = computed(() => {
  if (!props.replayEnabled) return '关闭'
  if (['missing-account-input', 'missing-replay-fee-input'].includes(props.replay?.status)) return '缺输入'
  return `${props.replay?.tradeCount ?? 0} 笔`
})
const hasRunnableProfileReplay = computed(
  () => props.replayEnabled && props.profileReplays.some((item) => !item.replay?.status),
)

function money(v) {
  return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—'
}
function pct(v) {
  return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—'
}
</script>

<template>
  <div class="dd-tier-group">
    <div class="dd-tier-label"><span>中枢与回放</span></div>

    <DisclosureSection title="中枢公式" meta="历史前缀" tone="research">
      <MarketCentersPanel
        :snapshot="graph?.marketCenters"
        :query-state="graph?.marketCentersQuery"
        :config="centerConfig"
        :source-key="sourceKey"
        :native-settings="nativeCenterSettings"
        @center-input-change="emit('center-input-change', $event)"
      />
      <details class="dd-sub-details">
        <summary>价格滤波与首达概率</summary>
        <CausalModelPanel :snapshot="graph?.causalModel" :query-state="graph?.causalModelQuery" />
      </details>
    </DisclosureSection>

    <DisclosureSection
      title="策略档位"
      :meta="autoProfile ? '自动' : activeProfileLabel"
      :default-open="false"
      storage-key="decision.profile"
      tone="muted"
    >
      <div class="dd-profile-tabs">
        <button :class="{ active: autoProfile }" :disabled="!replayEnabled" @click="emit('set-auto-profile', true)">
          自动
        </button>
        <button
          v-for="p in profileList"
          :key="p.id"
          :class="{ active: !autoProfile && activeProfileId === p.id }"
          @click="emit('set-profile', p.id)"
        >
          {{ p.label }}
        </button>
      </div>
      <p v-if="!replayEnabled" class="replay-empty">未开启现货回放（可在「参数」页开启）</p>
      <p v-else-if="!hasRunnableProfileReplay" class="replay-empty">填写可用现金或底仓后显示各档收益</p>
      <ul v-else class="dd-profile-grid">
        <li
          v-for="item in profileReplays"
          :key="item.profile.id"
          :class="{ active: item.profile.id === activeProfileId }"
        >
          <span>{{ item.profile.label }}</span>
          <strong>{{ pct(item.replay.returnOnUsedNotional) }}</strong>
          <em>回撤 {{ money(item.replay.maxDrawdown) }} · {{ item.replay.tradeCount }} 笔</em>
        </li>
      </ul>
    </DisclosureSection>

    <DisclosureSection
      v-if="replayEnabled"
      title="现货回放"
      :meta="replayMeta"
      :default-open="false"
      storage-key="decision.replay"
      tone="muted"
    >
      <ReplayPanel
        :replay="replay"
        :profile-replays="profileReplays"
        :active-profile-id="activeProfileId"
        :input="input"
        @patch-input="(patch) => emit('patch-input', patch)"
      />
    </DisclosureSection>

    <DisclosureSection
      v-if="portfolioEnabled"
      title="组合估值"
      :default-open="false"
      storage-key="decision.portfolio"
      tone="research"
    >
      <div class="dd-risk-row">
        <span>组合净值</span>
        <strong :class="(graph?.portfolio ?? 0) >= 0 ? 'green' : 'red'">{{ money(graph?.portfolio) }}</strong>
      </div>
    </DisclosureSection>
  </div>
</template>

<style scoped>
.dd-sub-details {
  margin-top: 4px;
  font-size: 0.72rem;
}
.dd-sub-details > summary {
  cursor: pointer;
  color: var(--muted);
  padding: 4px 2px;
  font-weight: 600;
}
.dd-sub-details > summary:hover {
  color: var(--ink);
}
</style>
