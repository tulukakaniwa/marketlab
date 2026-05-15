<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Activity } from 'lucide-vue-next'
import TopBar from './components/TopBar.vue'
import MainChart from './components/MainChart.vue'
import LeftPanel from './components/LeftPanel.vue'
import RightPanel from './components/RightPanel.vue'
import { useLabStore } from './stores/labStore.js'
import { clearPersistedLab, persistedRef } from './composables/usePersisted.js'
import stockIndex from './data/stock-index.json'

const lab = useLabStore()

// 主题持久化
const theme = persistedRef('lab.theme.v1', 'light')
function applyTheme(t) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', t === 'dark')
}
applyTheme(theme.value)
watch(theme, applyTheme)
function toggleTheme() { theme.value = theme.value === 'dark' ? 'light' : 'dark' }

function resetWorkbench() {
  if (!confirm('清空所有持久化参数（输入、UI 状态、主题）并刷新？')) return
  clearPersistedLab()
  window.location.reload()
}

// 窄屏自动折叠：< 900px 时强制收两侧（不写回 store，保留用户持久值）
const narrowScreen = ref(false)
let mediaQuery = null
function syncNarrowScreen() {
  narrowScreen.value = mediaQuery?.matches ?? false
}
onMounted(() => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    mediaQuery = window.matchMedia('(max-width: 900px)')
    syncNarrowScreen()
    mediaQuery.addEventListener('change', syncNarrowScreen)
  }
})
onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', syncNarrowScreen)
})

const effectiveLeftOpen = computed(() => !narrowScreen.value && lab.leftPanelOpen)
const effectiveRightOpen = computed(() => !narrowScreen.value && lab.rightPanelOpen)

// 合并 marketSamples + stockIndex 给搜索
const allSamples = computed(() => {
  const curated = new Map(lab.marketSamples.map(s => [s.symbol, s]))
  for (const s of stockIndex) {
    if (!curated.has(s.symbol)) curated.set(s.symbol, s)
  }
  return [...curated.values()]
})

// 决策摘要派生
const briefConfidence = computed(() => lab.graph?.decision?.signalStrength ?? 0)

function onParamChange(field, value) {
  if (lab.input && field in lab.input) {
    lab.input[field] = value
  }
}

function onSetProfile(id) {
  lab.featureFlags.replayAutoProfile = false
  lab.input.strategyProfile = id
}
function onSetAutoProfile(v) {
  lab.featureFlags.replayAutoProfile = v
  if (v) lab.featureFlags.replayAccount = true
}

// 拖宽逻辑（v3.2）
let dragging = null
let pendingW = 0
let rafId = null

function onResizerMouseDown(side, e) {
  dragging = side
  e.preventDefault()
  document.addEventListener('mousemove', onResizerMouseMove)
  document.addEventListener('mouseup', onResizerMouseUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

function onResizerMouseMove(e) {
  if (!dragging) return
  pendingW = dragging === 'left' ? e.clientX : window.innerWidth - e.clientX
  if (rafId) return
  rafId = requestAnimationFrame(flushW)
}

function flushW() {
  if (dragging === 'left')  lab.setLeftPanelW(pendingW)
  if (dragging === 'right') lab.setRightPanelW(pendingW)
  rafId = null
}

function onResizerMouseUp() {
  dragging = null
  document.removeEventListener('mousemove', onResizerMouseMove)
  document.removeEventListener('mouseup', onResizerMouseUp)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  if (rafId) { cancelAnimationFrame(rafId); rafId = null }
}

function onResizerDblclick(side) {
  side === 'left' ? lab.resetLeftPanelW() : lab.resetRightPanelW()
}

const rootStyle = computed(() => ({
  '--left-w':  `${lab.leftPanelW}px`,
  '--right-w': `${lab.rightPanelW}px`,
}))
</script>

<template>
  <div
    class="app-root"
    :class="{
      'left-collapsed': !effectiveLeftOpen,
      'right-collapsed': !effectiveRightOpen,
    }"
    :style="rootStyle"
  >
    <TopBar
      :source="lab.source"
      :market="lab.market"
      :rows="lab.rows"
      :decision="lab.graph?.decision"
      :confidence="briefConfidence"
      :profile-id="lab.input.strategyProfile"
      :auto-profile="lab.featureFlags.replayAutoProfile"
      :profile-list="lab.strategyProfileList"
      :recommended-id="lab.recommendedProfile?.id ?? 'balanced'"
      :theme="theme"
      @set-profile="onSetProfile"
      @set-auto-profile="onSetAutoProfile"
      @toggle-theme="toggleTheme"
      @reset="resetWorkbench"
    />

    <p v-if="lab.error" class="err-bar" :class="`kind-${lab.error.kind}`">
      <span class="err-msg">{{ lab.error.message }}</span>
      <button v-if="lab.error.sample" class="err-btn" @click="lab.retryLast()" :disabled="lab.loading">
        {{ lab.loading ? '重试中…' : '重试' }}
      </button>
      <button class="err-btn err-dismiss" @click="lab.dismissError()">关闭</button>
    </p>

    <div class="cols">
      <LeftPanel
        :open="effectiveLeftOpen"
        :active-tab="lab.activeLeftTab"
        :lab="lab"
        :theme="theme"
        @toggle="lab.toggleLeftPanel"
        @set-tab="(name) => lab.activeLeftTab = name"
        @set-profile="onSetProfile"
        @set-auto-profile="onSetAutoProfile"
        @select-formula="(id) => lab.activeFormulaId = id"
        @override-tdpy="(sym, val) => lab.setTdpyOverride(sym, val)"
        @reset-tdpy="(sym) => lab.clearTdpyOverride(sym)"
        @set-theme="(t) => { theme.value = t }"
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
        <MainChart
          v-if="lab.rows.length"
          :rows="lab.rows"
          :cost-path="lab.costPath"
          :formula-path="lab.formulaPath"
          :entry-price="lab.input.entryPrice"
          :replay="lab.replay"
          :market="lab.market"
          :decision="lab.graph?.decision"
          :overlays="lab.chartOverlays"
          :input="lab.input"
          @cursor-change="(idx) => { if (idx !== null) lab.cursor = idx }"
          @param-change="onParamChange"
        />
        <div v-else class="empty-state">
          <Activity :size="36" />
          <strong>Market Lab</strong>
          <small v-if="lab.loading">加载中…{{ lab.loadingSampleId ? ' ' + lab.loadingSampleId : '' }}</small>
          <small v-else>右侧标的列表选品种加载（首次约 1~2 秒）</small>
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
        :open="effectiveRightOpen"
        :samples="allSamples"
        :current-source="lab.source"
        :loading-sample-id="lab.loadingSampleId"
        @toggle="lab.toggleRightPanel"
        @select-sample="lab.loadSample"
      />
    </div>
  </div>
</template>

<style>
.app-root {
  width: 100vw; height: 100vh;
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); color: var(--ink);
}
.app-root.left-collapsed { --left-w: 36px !important; }
.app-root.right-collapsed { --right-w: 36px !important; }

.cols {
  flex: 1; min-height: 0;
  display: grid;
  grid-template-columns: var(--left-w) auto 1fr auto var(--right-w);
  transition: grid-template-columns 200ms ease;
}
.app-root.left-collapsed .cols { grid-template-columns: 36px 1fr auto var(--right-w); }
.app-root.right-collapsed .cols { grid-template-columns: var(--left-w) auto 1fr 36px; }
.app-root.left-collapsed.right-collapsed .cols { grid-template-columns: 36px 1fr 36px; }

.resizer { width: 4px; cursor: col-resize; background: transparent; transition: background 100ms; user-select: none; }
.resizer:hover, .resizer:active { background: var(--green); }

.app-main { min-width: 0; min-height: 0; position: relative; overflow: hidden; }

.err-bar { flex-shrink: 0; display: flex; gap: 10px; align-items: center; margin: 0; padding: 5px 12px; background: var(--red); color: #fff; font-size: 0.76rem; }
.err-bar.kind-empty { background: #b8860b; }
.err-bar.kind-parse { background: #884d22; }
.err-bar.kind-network { background: var(--red); }
.err-msg { flex: 1; }
.err-btn { min-height: 22px; padding: 1px 9px; border: 1px solid rgba(255,255,255,0.5); border-radius: 4px; background: transparent; color: #fff; font-size: 0.7rem; font-weight: 800; cursor: pointer; }
.err-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
.err-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.err-dismiss { opacity: 0.8; }

.empty-state { width: 100%; height: 100%; display: grid; place-items: center; align-content: center; gap: 10px; color: var(--muted); }
.empty-state strong { font-size: 1.3rem; color: var(--ink); }
</style>
