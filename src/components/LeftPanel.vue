<script setup>
import { computed } from 'vue'
import DecisionDrawer from './DecisionDrawer.vue'
import ComputeDrawer from './ComputeDrawer.vue'
import SettingsDrawer from './SettingsDrawer.vue'

const props = defineProps({
  open: { type: Boolean, required: true },
  activeTab: { type: String, required: true }, // 'decision'|'compute'|'settings'
  // 整体 lab 引用，避免大量 props 透传
  lab: { type: Object, required: true },
  theme: { type: String, default: 'light' },
})

const emit = defineEmits([
  'toggle',
  'set-tab',
  // 透传给三个 *Drawer
  'set-profile',
  'set-auto-profile',
  'select-formula',
  'override-tdpy',
  'reset-tdpy',
  'set-theme',
  'reset-all',
])

const TAB_LABELS = {
  decision: '📈 回测',
  compute:  '📊 公式',
  settings: '⚙️ 设置',
}

const collapsedLabel = computed(() => TAB_LABELS[props.activeTab] || '面板')
</script>

<template>
  <aside class="lp" :class="{ open, collapsed: !open }">
    <!-- 折叠态：纯窄边按钮，点击展开 -->
    <button
      v-if="!open"
      type="button"
      class="lp-edge"
      :title="`展开 ${collapsedLabel}`"
      @click="emit('toggle')"
    >
      <span class="lp-edge-icon">▶</span>
      <span class="lp-edge-text">{{ collapsedLabel }}</span>
    </button>

    <!-- 展开态 -->
    <template v-else>
      <header class="lp-head">
        <nav class="lp-tabs">
          <button
            v-for="(label, key) in TAB_LABELS"
            :key="key"
            type="button"
            :class="{ active: activeTab === key }"
            @click="emit('set-tab', key)"
          >{{ label }}</button>
        </nav>
        <button class="lp-collapse" type="button" aria-label="收起左侧面板" title="收起" @click="emit('toggle')">◀</button>
      </header>

      <div class="lp-body">
        <DecisionDrawer
          v-if="activeTab === 'decision'"
          :graph="lab.graph"
          :market="lab.market"
          :source-label="lab.sourceLabel"
          :rows="lab.activeRows"
          :observation-date="lab.observationDate"
          :replay="lab.replay"
          :profile-replays="lab.profileReplays"
          :active-profile-id="lab.effectiveInput.strategyProfile"
          :auto-profile="lab.featureFlags.replayAutoProfile"
          :replay-enabled="lab.featureFlags.replayAccount"
          :profile-list="lab.strategyProfileList"
          :input="lab.input"
          @set-profile="(id) => emit('set-profile', id)"
          @set-auto-profile="(v) => emit('set-auto-profile', v)"
        />
        <ComputeDrawer
          v-else-if="activeTab === 'compute'"
          :graph="lab.graph"
          :market="lab.market"
          :rows="lab.rows"
          :cost-path="lab.costPath"
          :source-label="lab.sourceLabel"
          :active-formula-id="lab.activeFormulaId"
          :active-formula="lab.activeFormula"
          :portfolio-enabled="lab.featureFlags.portfolioResearch"
          @select-formula="(id) => emit('select-formula', id)"
        />
        <SettingsDrawer
          v-else-if="activeTab === 'settings'"
          :input="lab.input"
          :rows="lab.rows"
          :cursor="lab.cursor"
          :observation-date="lab.observationDate"
          :tdpy-meta="lab.tdpyMeta"
          :effective-tdpy="lab.effectiveTdpy"
          :symbol="lab.source?.symbol ?? ''"
          :overlays="lab.chartOverlays"
          :feature-flags="lab.featureFlags"
          :theme="theme"
          @override-tdpy="(sym, val) => emit('override-tdpy', sym, val)"
          @reset-tdpy="(sym) => emit('reset-tdpy', sym)"
          @set-theme="(t) => emit('set-theme', t)"
          @reset-all="emit('reset-all')"
          @set-observation-date="(date) => lab.setObservationDate(date)"
          @latest-observation="lab.useLatestObservation"
        />
      </div>
    </template>
  </aside>
</template>

<style>
.lp { height: 100%; min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--panel); border-right: 1px solid var(--line); overflow: hidden; }

/* 折叠态：竖排窄按钮 */
.lp-edge { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 8px; padding: 12px 0; border: none; background: transparent; color: var(--ink); cursor: pointer; }
.lp-edge:hover { background: var(--surface-active); color: var(--green); }
.lp-edge-icon { font-size: 0.78rem; }
.lp-edge-text { writing-mode: vertical-rl; font-size: 0.74rem; font-weight: 800; letter-spacing: 0.06em; }

/* 展开态 */
.lp-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px 8px 7px 10px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
.lp-tabs { display: flex; gap: 4px; flex: 1; min-width: 0; }
.lp-tabs button { flex: 1; min-width: 0; min-height: 26px; padding: 1px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.74rem; font-weight: 700; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp-tabs button:hover { border-color: var(--green); }
.lp-tabs button.active { background: var(--surface-active); border-color: var(--green); color: var(--green); }
.lp-collapse { width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); font-size: 0.72rem; cursor: pointer; flex-shrink: 0; }
.lp-collapse:hover { border-color: var(--green); color: var(--green); }
.lp-body { flex: 1; min-width: 0; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 10px 12px; }
.lp-body > * { min-width: 0; max-width: 100%; }
</style>
