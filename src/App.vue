<script setup>
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue'
import { Activity } from 'lucide-vue-next'
import TopBar from './components/TopBar.vue'
import ChartWorkspace from './components/ChartWorkspace.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import ResearchObservationControl from './components/market-impact/ResearchObservationControl.vue'
import { useLabStore } from './stores/labStore.js'
import { clearPersistedLab, persistedRef } from './composables/usePersisted.js'
import { useBreakpoint } from './composables/useBreakpoint.js'
import { useAlignedImpactView } from './composables/useAlignedImpactView.js'
import { useImpactChartOverlay } from './composables/useImpactChartOverlay.js'
import { APP_SURFACES, useAppSurface } from './composables/useAppSurface.js'
import { useTheme } from './composables/useTheme.js'
import { usePanelResize } from './composables/usePanelResize.js'
import { usePortfolioRotation } from './composables/usePortfolioRotation.js'
import stockIndex from './data/stock-index.json'

const RecommendedPoolPage = defineAsyncComponent(() => import('./components/RecommendedPoolPage.vue'))
const EthDecisionReplay = defineAsyncComponent(() => import('./components/eth-replay/EthDecisionReplay.vue'))
const AlignedImpactChart = defineAsyncComponent(() => import('./components/market-impact/AlignedImpactChart.vue'))
const MarketImpactResearchDialog = defineAsyncComponent(
  () => import('./components/market-impact/MarketImpactResearchDialog.vue'),
)
const PortfolioRotationDialog = defineAsyncComponent(() => import('./components/PortfolioRotationDialog.vue'))

const QUICK_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'NVDA', '600519', '0700.HK']

const lab = useLabStore()
const impactMap = useImpactChartOverlay(lab)
const aligned = useAlignedImpactView()
const { isCompact } = useBreakpoint()
const { theme, toggleTheme, setTheme } = useTheme()
const { rootStyle, onResizerMouseDown, onResizerDblclick } = usePanelResize(lab)

const mobileLeftOpen = ref(false)
const mobileRightOpen = ref(false)
const nativeCenterSettings = ref(false)
const lastSampleId = persistedRef('lab.lastSampleId.v1', '')

function closeMobileDrawers() {
  mobileLeftOpen.value = false
  mobileRightOpen.value = false
}

const {
  surface,
  navigateSurface,
  impactResearchOpen,
  impactResearchVisited,
  openImpactResearch: openImpactDialog,
  closeImpactResearch,
} = useAppSurface({
  onEscapeCompact: () => {
    if (isCompact.value && (mobileLeftOpen.value || mobileRightOpen.value)) {
      closeMobileDrawers()
      return true
    }
    return false
  },
})

watch(aligned.active, (active) => {
  if (active && aligned.live.value) closeImpactResearch()
})

const allSamples = computed(() => {
  const curated = new Map(lab.marketSamples.map((s) => [s.symbol, s]))
  for (const s of stockIndex) {
    if (!curated.has(s.symbol)) curated.set(s.symbol, s)
  }
  return [...curated.values()]
})
const rotation = usePortfolioRotation(allSamples)

function jumpToRotationSymbol(symbol) {
  const found = allSamples.value.find((item) => item.symbol === symbol)
  if (found) {
    selectSample(found)
    if (lab.chartStrategyId === 'off') lab.setChartStrategy('lp-carry-hybrid')
  }
  rotation.closeRotation()
}

const quickSamples = computed(() =>
  QUICK_SYMBOLS.map((sym) => allSamples.value.find((s) => s.symbol === sym)).filter(Boolean),
)

onMounted(() => {
  if (!lab.rows.length && allSamples.value.length) {
    const saved = lastSampleId.value ? allSamples.value.find((item) => item.id === lastSampleId.value) : null
    const fallback =
      saved ??
      allSamples.value.find((item) => item.symbol === 'BTCUSDT') ??
      allSamples.value.find((item) => item.symbol === 'ETHUSDT') ??
      allSamples.value[0]
    if (fallback) {
      lastSampleId.value = fallback.id
      lab.loadSample(fallback)
    }
  }
})

const effectiveLeftOpen = computed(
  () => !aligned.active.value && (isCompact.value ? mobileLeftOpen.value : lab.leftPanelOpen),
)
const effectiveRightOpen = computed(
  () => !aligned.active.value && (isCompact.value ? mobileRightOpen.value : lab.rightPanelOpen),
)
const briefExtremeness = computed(() => lab.graph?.decision?.signalStrength ?? 0)
const topBarMarket = computed(() =>
  aligned.active.value ? { markPrice: aligned.rows.value.at(-1)?.close ?? null } : lab.market,
)

function resetWorkbench() {
  if (!confirm('恢复默认参数并刷新工作台？')) return
  clearPersistedLab()
  window.location.reload()
}

function onParamChange(field, value) {
  if (typeof lab.setInputField === 'function') {
    lab.setInputField(field, value)
  } else if (lab.input && field in lab.input) {
    lab.input[field] = value
  }
}

function onSetProfile(id) {
  lab.featureFlags.replayAutoProfile = false
  onParamChange('strategyProfile', id)
}

function onSetAutoProfile(enabled) {
  lab.featureFlags.replayAutoProfile = Boolean(enabled)
  if (enabled) lab.featureFlags.replayAccount = true
}

function selectSample(sample) {
  aligned.close()
  lastSampleId.value = sample.id
  lab.loadSample(sample)
  if (isCompact.value) closeMobileDrawers()
}

function toggleLeftPanel() {
  aligned.close()
  if (isCompact.value) {
    mobileLeftOpen.value = !mobileLeftOpen.value
    if (mobileLeftOpen.value) mobileRightOpen.value = false
    return
  }
  lab.toggleLeftPanel()
}

function toggleRightPanel() {
  aligned.close()
  if (isCompact.value) {
    mobileRightOpen.value = !mobileRightOpen.value
    if (mobileRightOpen.value) mobileLeftOpen.value = false
    return
  }
  lab.toggleRightPanel()
}

function openMobileLeft() {
  aligned.close()
  mobileLeftOpen.value = true
  mobileRightOpen.value = false
}

function openMobileRight() {
  aligned.close()
  mobileRightOpen.value = true
  mobileLeftOpen.value = false
}

function openImpactResearch() {
  closeMobileDrawers()
  openImpactDialog()
}

function showImpactOnChart() {
  if (aligned.show()) {
    closeMobileDrawers()
    closeImpactResearch()
    return
  }
  lab.setChartOverlay('impactReferenceMap', true)
  if (!['ETH', 'WETH'].includes(impactMap.value?.asset)) {
    const sample = allSamples.value.find((item) => item.symbol === 'ETHUSDT')
    if (sample) selectSample(sample)
  }
  closeImpactResearch()
}
</script>

<template>
  <RecommendedPoolPage
    v-if="surface === APP_SURFACES.RECOMMENDED_POOL"
    @back="navigateSurface(APP_SURFACES.WORKBENCH)"
  />
  <EthDecisionReplay v-else-if="surface === APP_SURFACES.ETH_REPLAY" @back="navigateSurface(APP_SURFACES.WORKBENCH)" />
  <div
    v-else
    class="app-root"
    :class="{
      'left-collapsed': !effectiveLeftOpen,
      'right-collapsed': !effectiveRightOpen,
    }"
    :style="rootStyle"
  >
    <TopBar
      :source="aligned.active.value ? aligned.source.value : lab.source"
      :market="topBarMarket"
      :rows="aligned.active.value ? aligned.rows.value : lab.rows"
      :research-only="aligned.active.value"
      :decision="aligned.active.value ? null : lab.graph?.decision"
      :extremeness="briefExtremeness"
      :profile-id="lab.input.strategyProfile"
      :auto-profile="lab.featureFlags.replayAutoProfile"
      :profile-list="lab.strategyProfileList"
      :recommended-id="lab.recommendedProfile?.id ?? 'balanced'"
      :theme="theme"
      @set-profile="onSetProfile"
      @set-auto-profile="onSetAutoProfile"
      @toggle-theme="toggleTheme"
      @reset="resetWorkbench"
      @toggle-right="toggleRightPanel"
      @mobile-open-left="openMobileLeft"
      @mobile-open-right="openMobileRight"
      @open-market-impact="openImpactResearch"
      @open-portfolio-rotation="rotation.openRotation"
      @open-eth-replay="navigateSurface(APP_SURFACES.ETH_REPLAY)"
      @open-recommended-pool="navigateSurface(APP_SURFACES.RECOMMENDED_POOL)"
    />

    <div
      v-if="isCompact && (effectiveLeftOpen || effectiveRightOpen)"
      class="mobile-backdrop"
      @click="closeMobileDrawers"
    />

    <p v-if="lab.error" class="err-bar" :class="`kind-${lab.error.kind}`">
      <span class="err-msg">{{ lab.error.message }}</span>
      <button v-if="lab.error.sample" class="err-btn" :disabled="lab.loading" @click="lab.retryLast()">
        {{ lab.loading ? '重试中…' : '重试' }}
      </button>
      <button class="err-btn err-dismiss" @click="lab.dismissError()">关闭</button>
    </p>

    <div class="cols" :class="{ 'aligned-layout': aligned.active.value }">
      <LeftPanel
        v-show="!aligned.active.value"
        :open="effectiveLeftOpen"
        :active-tab="lab.activeLeftTab"
        :lab="lab"
        :theme="theme"
        :native-center-settings="nativeCenterSettings"
        @toggle="toggleLeftPanel"
        @set-tab="(name) => (lab.activeLeftTab = name)"
        @set-profile="onSetProfile"
        @set-auto-profile="onSetAutoProfile"
        @select-formula="lab.selectFormula"
        @override-tdpy="(sym, val) => lab.setTdpyOverride(sym, val)"
        @reset-tdpy="(sym) => lab.clearTdpyOverride(sym)"
        @set-theme="setTheme"
        @set-overlay="lab.setChartOverlay"
        @reset-all="resetWorkbench"
      />

      <div
        v-if="effectiveLeftOpen"
        class="resizer resizer-left"
        title="拖动调宽，双击重置"
        @mousedown="(e) => onResizerMouseDown('left', e)"
        @dblclick="onResizerDblclick('left')"
      />

      <main class="app-main">
        <p v-if="aligned.active.value && aligned.retentionNotice.value" class="bottom-boundary" role="status">
          {{ aligned.retentionNotice.value }}
        </p>
        <ResearchObservationControl
          v-if="aligned.active.value"
          :rows="aligned.allRows.value"
          :cursor="aligned.cursor.value"
          @cursor-change="aligned.setCursor"
        />
        <AlignedImpactChart
          v-if="aligned.active.value"
          :rows="aligned.rows.value"
          :source="aligned.source.value"
          :impact-map="aligned.impactMap.value"
          :theme="theme"
          @open-research="openImpactResearch"
          @return-daily="aligned.close"
        />
        <ChartWorkspace
          v-if="lab.activeRows.length"
          v-show="!aligned.active.value"
          :rows="lab.activeRows"
          :source="lab.source"
          :cost-path="lab.costPath"
          :formula-path="lab.formulaPath"
          :causal-path="lab.causalPath"
          :center-path="lab.centerPath"
          :reference-map="lab.priceReferenceMap"
          :reference-query="lab.priceReferenceQuery"
          :impact-map="impactMap"
          :center-config="lab.centerConfig"
          :entry-price="lab.input.entryPrice"
          :replay="lab.replay"
          :market="lab.market"
          :decision="lab.graph?.decision"
          :position="lab.graph?.position"
          :summary="lab.workbenchSummary"
          :drawing-scope="lab.sourceKey"
          :overlays="lab.chartOverlays"
          :input="lab.input"
          :chart-strategy="lab.chartStrategy"
          :chart-strategy-id="lab.chartStrategyId"
          :chart-strategy-catalog="lab.chartStrategyCatalog"
          :theme="theme"
          @param-change="onParamChange"
          @cursor-change="lab.setHoverIndex"
          @set-overlay="lab.setChartOverlay"
          @set-chart-strategy="lab.setChartStrategy"
          @center-input-change="lab.setCenterInput"
          @native-settings-change="(enabled) => (nativeCenterSettings = enabled)"
          @open-market-impact="openImpactResearch"
          @open-portfolio-rotation="rotation.openRotation"
        />
        <div v-else-if="!aligned.active.value" class="empty-state">
          <div class="empty-state-brand">
            <Activity :size="28" style="color: var(--green)" />
            <strong>Market Lab</strong>
            <small v-if="lab.loading">正在载入 {{ lab.loadingSampleId || '行情样本' }}…</small>
            <small v-else>选择品种载入 K 线与价格带</small>
          </div>
          <div v-if="!lab.loading && quickSamples.length" class="empty-quick-picks">
            <button
              v-for="item in quickSamples"
              :key="item.id"
              type="button"
              class="empty-pick-btn"
              @click="selectSample(item)"
            >
              <code>{{ item.symbol }}</code>
              <span>{{ item.label }}</span>
            </button>
          </div>
        </div>
      </main>

      <div
        v-if="effectiveRightOpen"
        class="resizer resizer-right"
        title="拖动调宽，双击重置"
        @mousedown="(e) => onResizerMouseDown('right', e)"
        @dblclick="onResizerDblclick('right')"
      />

      <RightPanel
        v-show="!aligned.active.value"
        :open="effectiveRightOpen"
        :samples="allSamples"
        :current-source="lab.source"
        :loading-sample-id="lab.loadingSampleId"
        @toggle="toggleRightPanel"
        @select-sample="selectSample"
      />
    </div>
    <MarketImpactResearchDialog
      v-if="impactResearchVisited"
      :open="impactResearchOpen"
      @close="closeImpactResearch"
      @show-on-chart="showImpactOnChart"
    />
    <PortfolioRotationDialog
      v-if="rotation.visited.value"
      :open="rotation.open.value"
      :running="rotation.running.value"
      :error="rotation.error.value"
      :presets="rotation.presets"
      :preset-id="rotation.presetId.value"
      :max-slots="rotation.maxSlots.value"
      :use-maker-ladder="rotation.useMakerLadder.value"
      :result="rotation.result.value"
      @close="rotation.closeRotation"
      @select-preset="rotation.setPreset"
      @set-slots="rotation.setMaxSlots"
      @toggle-ladder="rotation.toggleMakerLadder"
      @jump-symbol="jumpToRotationSymbol"
    />
  </div>
</template>
