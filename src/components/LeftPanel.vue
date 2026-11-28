<script setup>
import { computed } from 'vue'
import { Crosshair, Sigma, SlidersHorizontal, PanelLeftClose, PanelLeftOpen, X } from 'lucide-vue-next'
import DecisionDrawer from './DecisionDrawer.vue'
import ComputeDrawer from './ComputeDrawer.vue'
import SettingsDrawer from './SettingsDrawer.vue'
import { useBreakpoint } from '../composables/useBreakpoint.js'

const { isCompact } = useBreakpoint()

const props = defineProps({
  open: { type: Boolean, required: true },
  activeTab: { type: String, required: true },
  lab: { type: Object, required: true },
  theme: { type: String, default: 'dark' },
  nativeCenterSettings: { type: Boolean, default: false },
})

const emit = defineEmits([
  'toggle',
  'set-tab',
  'set-profile',
  'set-auto-profile',
  'select-formula',
  'override-tdpy',
  'reset-tdpy',
  'set-theme',
  'set-overlay',
  'reset-all',
])

const TABS = [
  { key: 'decision', label: '结论', icon: Crosshair },
  { key: 'compute', label: '公式', icon: Sigma },
  { key: 'settings', label: '参数', icon: SlidersHorizontal },
]

const collapsedLabel = computed(() => TABS.find((t) => t.key === props.activeTab)?.label || '面板')
</script>

<template>
  <aside
    class="lp"
    :class="{
      open,
      collapsed: !open,
      'lp-mobile': isCompact,
      'lp-mobile-open': isCompact && open,
    }"
    :role="isCompact && open ? 'dialog' : null"
    :aria-modal="isCompact && open ? 'true' : null"
    :aria-hidden="isCompact && !open ? 'true' : null"
    :inert="isCompact && !open ? '' : null"
    aria-label="左侧工具面板"
  >
    <button v-if="isCompact" class="lp-mobile-close" type="button" aria-label="关闭" @click="emit('toggle')">
      <X :size="18" />
    </button>

    <button v-if="!open" type="button" class="lp-edge" :title="`展开${collapsedLabel}面板`" @click="emit('toggle')">
      <PanelLeftOpen :size="15" />
      <span class="lp-edge-text">{{ collapsedLabel }}</span>
    </button>

    <template v-else>
      <header class="lp-head">
        <nav class="lp-tabs" role="tablist" aria-label="工具面板">
          <button
            v-for="tab in TABS"
            :key="tab.key"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.key"
            :class="{ active: activeTab === tab.key }"
            @click="emit('set-tab', tab.key)"
          >
            <component :is="tab.icon" :size="13" />
            <span>{{ tab.label }}</span>
          </button>
        </nav>
        <button class="lp-collapse" type="button" aria-label="收起左侧面板" title="收起面板" @click="emit('toggle')">
          <PanelLeftClose :size="14" />
        </button>
      </header>

      <div class="lp-body">
        <DecisionDrawer
          v-if="activeTab === 'decision'"
          :graph="lab.graph"
          :market="lab.market"
          :source-label="lab.sourceLabel"
          :rows="lab.activeRows"
          :all-rows="lab.rows"
          :cursor="lab.cursor"
          :observation-date="lab.observationDate"
          :replay="lab.replay"
          :profile-replays="lab.profileReplays"
          :active-profile-id="lab.effectiveInput.strategyProfile"
          :auto-profile="lab.featureFlags.replayAutoProfile"
          :replay-enabled="lab.featureFlags.replayAccount"
          :portfolio-enabled="lab.featureFlags.portfolioResearch"
          :profile-list="lab.strategyProfileList"
          :input="lab.input"
          :center-config="lab.centerConfig"
          :source-key="lab.sourceKey"
          :native-center-settings="nativeCenterSettings"
          @center-input-change="lab.setCenterInput"
          @patch-input="lab.patchInput"
          @set-profile="(id) => emit('set-profile', id)"
          @set-auto-profile="(v) => emit('set-auto-profile', v)"
          @set-observation-date="(date) => lab.setObservationDate(date)"
          @latest-observation="lab.useLatestObservation"
        />
        <ComputeDrawer
          v-else-if="activeTab === 'compute'"
          :graph="lab.graph"
          :market="lab.market"
          :rows="lab.activeRows"
          :cost-path="lab.costPath"
          :formula-path="lab.formulaPath"
          :source-label="lab.sourceLabel"
          :active-formula-id="lab.activeFormulaId"
          :active-formula="lab.activeFormula"
          :portfolio-enabled="lab.featureFlags.portfolioResearch"
          :hover-row="lab.hoverRow"
          :hover-prev-row="lab.hoverPrevRow"
          :hover-date="lab.hoverDate"
          :is-hovering="lab.isHovering"
          :summary="lab.workbenchSummary"
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
          :symbol="lab.tdpyOverrideKey"
          :overlays="lab.chartOverlays"
          :feature-flags="lab.featureFlags"
          :profile-list="lab.strategyProfileList"
          :graph="lab.graph"
          :theme="theme"
          @override-tdpy="(sym, val) => emit('override-tdpy', sym, val)"
          @reset-tdpy="(sym) => emit('reset-tdpy', sym)"
          @set-theme="(t) => emit('set-theme', t)"
          @set-overlay="(key, value) => emit('set-overlay', key, value)"
          @set-path-scenario="lab.setPathUsesScenarioInputs"
          @set-lp-scenario-field="lab.setLpScenarioField"
          @patch-input="lab.patchInput"
          @set-feature-flag="lab.setFeatureFlag"
          @reset-all="emit('reset-all')"
          @set-observation-date="(date) => lab.setObservationDate(date)"
          @latest-observation="lab.useLatestObservation"
        />
      </div>
    </template>
  </aside>
</template>

<style>
.lp {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-right: 1px solid var(--line);
  overflow: hidden;
}

.lp-edge {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 12px 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
}
.lp-edge:hover {
  background: var(--surface-hover);
  color: var(--green);
}
.lp-edge-text {
  writing-mode: vertical-rl;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.lp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.lp-tabs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-sm);
  background: var(--bg);
  border: 1px solid var(--line);
  flex: 1;
  min-width: 0;
}
.lp-tabs button {
  min-width: 0;
  min-height: 26px;
  padding: 2px 6px;
  border: none;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--muted);
  font-size: 0.73rem;
  font-weight: 600;
  white-space: nowrap;
}
.lp-tabs button:hover {
  color: var(--ink);
  background: var(--surface-hover);
}
.lp-tabs button.active {
  background: var(--surface);
  color: var(--green);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
}
.lp-collapse {
  width: 28px;
  height: 28px;
  min-height: 28px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--muted);
  flex-shrink: 0;
}
.lp-collapse:hover {
  background: var(--surface-hover);
  color: var(--ink);
}
.lp-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  padding: 10px;
}
.lp-body > * {
  min-width: 0;
  max-width: 100%;
}

.lp-mobile-close {
  display: none;
}

@media (max-width: 1279px) {
  .lp.lp-mobile {
    position: fixed;
    top: 0;
    left: 0;
    width: min(380px, 92vw);
    height: 100vh;
    height: 100dvh;
    z-index: 50;
    background: var(--panel);
    transform: translateX(-100%);
    transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
    box-shadow: var(--shadow-pop);
  }
  .lp.lp-mobile.lp-mobile-open {
    transform: translateX(0);
  }
  .lp.lp-mobile .lp-mobile-close {
    display: grid;
    place-items: center;
    position: absolute;
    top: 10px;
    right: 10px;
    width: 36px;
    height: 36px;
    padding: 0;
    z-index: 51;
  }
  .lp.lp-mobile .lp-head {
    min-height: 56px;
    padding-right: 52px;
  }
  .lp.lp-mobile .lp-tabs button {
    min-height: 34px;
  }
  .lp.lp-mobile .lp-collapse {
    display: none;
  }
}
</style>
