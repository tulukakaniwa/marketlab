<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { Activity, Database, Moon, Play, Sun } from 'lucide-vue-next'
import ChainFlow from './components/ChainFlow.vue'
import DecisionPanel from './components/DecisionPanel.vue'
import FormulaChart from './components/FormulaChart.vue'
import FormulaDrawer from './components/FormulaDrawer.vue'
import FormulaNav from './components/FormulaNav.vue'
import MarketChart from './components/MarketChart.vue'
import MetricStrip from './components/MetricStrip.vue'
import OrderTable from './components/OrderTable.vue'
import QuestionNav from './components/QuestionNav.vue'
import ReplayPanel from './components/ReplayPanel.vue'
import { useLabStore } from './stores/labStore.js'
import { clearPersistedLab, persistedRef } from './composables/usePersisted.js'
import stockIndex from './data/stock-index.json'

const lab = useLabStore()

const tickerSearch = ref('')
const searchInput = ref(null)
const showAllFormulas = ref(false)
const drawerOpen = ref(false)

// 主题（dark / light）持久化
const theme = persistedRef('lab.theme.v1', 'light')
function applyTheme(t) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', t === 'dark')
}
applyTheme(theme.value)
watch(theme, applyTheme)
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

function resetWorkbench() {
  if (!confirm('清空所有持久化参数（输入、UI 状态、主题）并刷新？')) return
  clearPersistedLab()
  window.location.reload()
}

function focusSearch() {
  searchInput.value?.focus()
}

function openDrawer(formulaId) {
  if (formulaId) lab.activeFormulaId = formulaId
  drawerOpen.value = true
}
const allSamples = computed(() => {
  const curated = new Map(lab.marketSamples.map(s => [s.symbol, s]))
  for (const s of stockIndex) {
    if (!curated.has(s.symbol)) curated.set(s.symbol, s)
  }
  return [...curated.values()]
})
const filteredSamples = computed(() => {
  const q = tickerSearch.value.trim().toLowerCase()
  if (!q) return lab.marketSamples
  return allSamples.value.filter(s =>
    s.symbol.toLowerCase().includes(q) || s.label.toLowerCase().includes(q)
  )
})

function onSearchEnter() {
  if (filteredSamples.value.length) lab.loadSample(filteredSamples.value[0])
}

const metrics = computed(() => {
  const m = lab.market; const g = lab.graph
  return [
    { label: '现价', value: money(m?.markPrice), unit: lab.sourceLabel },
    { label: '成本锚', value: money(m?.costAnchor), unit: pct(m?.costDistance) },
    { label: 'IV', value: pct(g.inputs?.iv), unit: `ATR ${pct(m?.atrPercent)}` },
    { label: '波动带', value: money(g.deltaBands?.long?.low), unit: money(g.deltaBands?.long?.high) },
    { label: '组合价值', value: money(g.portfolio), unit: g?.decision?.state ?? '等待' },
  ]
})

function money(v) { return Number.isFinite(v) ? new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(v) : '—' }
function pct(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' }
function cPct(v) { const n = Number(v); return Number.isFinite(n) ? n / 100 : 0 }
function rPct(v) { return Number.isFinite(v) ? Number((v * 100).toFixed(2)) : 0 }

const ivP = computed({ get: () => rPct(lab.input.iv), set: (v) => { lab.input.iv = cPct(v) } })
const trP = computed({ get: () => rPct(lab.input.targetReturn), set: (v) => { lab.input.targetReturn = cPct(v) } })

const brief = computed(() => {
  const g = lab.graph; const s = g?.decision?.state ?? '未载入'
  const side = g?.position?.side
  const verb = side === 'buy' ? '低价买入' : side === 'sell' && g?.plan?.primaryOrders?.length ? '底仓减压' : '等待低价'
  return {
    title: verb === s ? s : `${verb} · ${s}`,
    bias: side === 'buy' ? '安全低价买入' : side === 'sell' ? '卖出只做仓位保护' : '等待低价不追高',
    notional: g?.plan?.primaryOrders?.[0]?.notional ?? 0,
    price: g?.plan?.primaryOrders?.[0]?.price ?? null,
    stop: g?.position?.stopPrice ?? null,
    target: g?.position?.targetPrice ?? null,
    reason: g?.decision?.timing?.reason ?? '载入 K 线开始分析',
    confidence: Math.round((g?.decision?.confidence ?? 0) * 100),
  }
})
</script>

<template>
  <div class="app-root">
    <header class="top-bar">
      <div><span>Market Lab</span><h1>公式工作台</h1></div>
      <div class="bar-act">
        <input
          ref="searchInput"
          v-model="tickerSearch"
          class="ticker-search"
          type="search"
          placeholder="搜代码/名称…"
          list="ticker-list"
          @keydown.enter="onSearchEnter"
        />
        <datalist id="ticker-list">
          <option v-for="s in allSamples" :key="s.id" :value="s.symbol" />
        </datalist>
        <button v-for="s in filteredSamples" :key="s.id" :class="{ on: lab.source?.id === s.id }" :disabled="lab.loadingSampleId === s.id" @click="lab.loadSample(s)">
          <Database :size="14" />{{ lab.loadingSampleId === s.id ? '…' : s.symbol }}
        </button>
        <button class="theme-btn" @click="toggleTheme" title="切换主题">
          <Moon v-if="theme === 'light'" :size="14" />
          <Sun v-else :size="14" />
        </button>
        <button class="reset-btn" @click="resetWorkbench" title="清空持久化参数">重置</button>
      </div>
    </header>
    <p v-if="lab.error" class="err-bar" :class="`kind-${lab.error.kind}`">
      <span class="err-msg">{{ lab.error.message }}</span>
      <button v-if="lab.error.sample" class="err-btn" @click="lab.retryLast()" :disabled="lab.loading">
        {{ lab.loading ? '重试中…' : '重试' }}
      </button>
      <button class="err-btn err-dismiss" @click="lab.dismissError()">关闭</button>
    </p>

    <div v-if="lab.rows.length" class="workbench">
      <aside class="wb-left">
        <QuestionNav
          :active-formula-id="lab.activeFormulaId"
          :source="lab.source"
          :input="lab.input"
          @select-formula="lab.activeFormulaId = $event"
          @focus-search="focusSearch"
          @open-drawer="openDrawer"
        />
        <details class="wb-formulas-toggle" :open="showAllFormulas">
          <summary @click.prevent="showAllFormulas = !showAllFormulas">
            完整公式列表（点击查看每个公式）
          </summary>
          <FormulaNav :active-id="lab.activeFormulaId" @select="(id) => { lab.activeFormulaId = id; openDrawer(id) }" />
        </details>
      </aside>

      <main class="wb-center">
        <div class="cursor-bar" v-if="lab.rows.length">
          <span>光标 {{ lab.rows[lab.cursor]?.date || lab.rows.at(-1)?.date }}</span>
          <span>数据 {{ lab.cursor + 1 }} / {{ lab.rows.length }} 条（仅用左侧）</span>
        </div>
        <MetricStrip :items="metrics" />
        <ChainFlow :graph="lab.graph" :market="lab.market" :active-id="lab.activeFormulaId" @select="lab.activeFormulaId = $event" />

        <section class="wb-chart">
          <MarketChart :rows="lab.rows" :cost-path="lab.costPath" :formula-path="lab.formulaPath" :entry-price="lab.input.entryPrice" :graph="lab.graph" :replay="lab.replay" @cursor-change="(idx) => { if (idx !== null) lab.cursor = idx }" />
        </section>

        <section class="wb-formula">
          <header class="wf-head">
            <div>
              <span>{{ lab.activeFormula.layer }} · {{ lab.activeFormula.label }}</span>
              <strong>{{ lab.activeFormula.role }}</strong>
            </div>
            <div class="wf-params">
              <label><span>入场价</span><input v-model.number="lab.input.entryPrice" type="number" /></label>
              <label><span>窗口(天)</span><input v-model.number="lab.input.holdingDays" type="number" /></label>
              <label><span>波动率%</span><input v-model.number="ivP" type="number" /></label>
              <label><span>目标%</span><input v-model.number="trP" type="number" /></label>
              <label><span>年时间基</span><select v-model.number="lab.input.tradingDaysPerYear" class="ws-sel"><option :value="365">365 日历</option><option :value="252">252 美股</option><option :value="242">242 港股</option><option :value="179">179 质数基</option></select></label>
            </div>
          </header>

          <FormulaChart :formula-id="lab.activeFormulaId" :graph="lab.graph" :market="lab.market" :rows="lab.rows" :cost-path="lab.costPath" />

          <div class="wf-io">
            <div><b>输入</b><span>{{ lab.activeFormula.inputs.join(' / ') }}</span></div>
            <div><b>输出</b><span>{{ lab.activeFormula.outputs.join(' / ') }}</span></div>
            <div v-if="lab.activeFormula.formulas.length"><b>公式</b><code v-for="f in lab.activeFormula.formulas" :key="f">{{ f }}</code></div>
          </div>
        </section>
      </main>

      <aside class="wb-right">
        <div class="exec-strip">
          <span>决策 · {{ brief.confidence }}% 置信</span>
          <strong>{{ brief.title }}</strong>
          <em>{{ brief.bias }}</em>
          <div class="exec-nums">
            <div><span>首笔</span><strong>{{ money(brief.notional) }}</strong></div>
            <div><span>挂单</span><strong>{{ money(brief.price) }}</strong></div>
            <div><span>失效</span><strong>{{ money(brief.stop) }}</strong></div>
            <div><span>目标</span><strong>{{ money(brief.target) }}</strong></div>
          </div>
          <small>{{ brief.reason }}</small>
        </div>

        <div class="mode-tabs">
          <button :class="{ active: lab.activeMode === 'orders' }" @click="lab.activeMode = 'orders'">计划</button>
          <button :class="{ active: lab.activeMode === 'risk' }" @click="lab.activeMode = 'risk'">风险</button>
          <button :class="{ active: lab.activeMode === 'formula' }" @click="lab.activeMode = 'formula'">依据</button>
        </div>
        <div class="prof-tabs">
          <button :class="{ active: lab.input.autoProfile }" @click="lab.input.autoProfile = true">接管</button>
          <button v-for="p in lab.strategyProfileList" :key="p.id" :class="{ active: !lab.input.autoProfile && lab.input.strategyProfile === p.id }" @click="lab.input.autoProfile = false; lab.input.strategyProfile = p.id">{{ p.label }}</button>
        </div>

        <DecisionPanel :graph="lab.graph" :market="lab.market" />
        <ReplayPanel :replay="lab.replay" :profile-replays="lab.profileReplays" :active-profile-id="lab.effectiveInput.strategyProfile" />

        <OrderTable v-if="lab.activeMode === 'orders'" :title="lab.graph.decision?.timing?.side === 'sell' ? '底仓减压' : '分批低价买入'" :orders="lab.graph.plan.primaryOrders" />
        <template v-if="lab.activeMode === 'risk'">
          <div class="risk-box"><span>失效线</span><strong>{{ money(lab.graph.plan.invalidation.lower) }} / {{ money(lab.graph.plan.invalidation.upper) }}</strong></div>
          <div class="risk-box"><span>组合价值</span><strong :class="(lab.graph.portfolio ?? 0) >= 0 ? 'green' : 'red'">{{ money(lab.graph.portfolio) }}</strong></div>
        </template>
      </aside>
    </div>

    <div v-else class="empty-state">
      <Activity :size="36" />
      <strong>Market Lab</strong>
      <small v-if="lab.loading">加载中…{{ lab.loadingSampleId ? ' ' + lab.loadingSampleId : '' }}</small>
      <small v-else>点击上方数据集加载 K 线（首次加载约 1~2 秒）</small>
    </div>

    <FormulaDrawer
      :open="drawerOpen"
      :formula-id="lab.activeFormulaId"
      :graph="lab.graph"
      :market="lab.market"
      @close="drawerOpen = false"
    />
  </div>
</template>

<style>
/* ── Root ── */
.app-root { width: 100vw; height: 100vh; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); color: var(--ink); }
.top-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-shrink: 0; border-bottom: 1px solid var(--line); padding: 6px 12px; background: var(--panel); }
.top-bar span { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.07em; text-transform: uppercase; }
.top-bar h1 { margin: 0; font-size: 1rem; line-height: 1.1; }
.bar-act { display: flex; gap: 5px; align-items: center; }
.bar-act button { display: inline-flex; gap: 4px; align-items: center; min-height: 28px; border: 1px solid var(--line); border-radius: 5px; padding: 3px 9px; background: var(--bg); color: var(--ink); font-weight: 700; font-size: 0.76rem; }
.bar-act button.on, .bar-act button:hover { border-color: var(--green); }
.bar-act button:disabled { opacity: 0.5; }
.ticker-search { width: 100px; min-height: 26px; border: 1px solid var(--line); border-radius: 5px; padding: 2px 6px; background: var(--bg); color: var(--ink); font-size: 0.72rem; font-weight: 600; font-variant-numeric: tabular-nums; }
.ticker-search::placeholder { color: var(--muted); font-weight: 400; }
.theme-btn { min-width: 28px; justify-content: center; border-radius: 99px; }
.reset-btn { font-size: 0.66rem !important; opacity: 0.7; }
.reset-btn:hover { opacity: 1; }
.err-bar { flex-shrink: 0; display: flex; gap: 10px; align-items: center; margin: 0; padding: 5px 12px; background: var(--red); color: #fff; font-size: 0.76rem; }
.err-bar.kind-empty { background: #b8860b; }
.err-bar.kind-parse { background: #884d22; }
.err-bar.kind-network { background: var(--red); }
.err-msg { flex: 1; }
.err-btn { min-height: 22px; padding: 1px 9px; border: 1px solid rgba(255,255,255,0.5); border-radius: 4px; background: transparent; color: #fff; font-size: 0.7rem; font-weight: 800; cursor: pointer; }
.err-btn:hover:not(:disabled) { background: rgba(255,255,255,0.15); }
.err-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.err-dismiss { opacity: 0.8; }

/* ── Empty ── */
.empty-state { flex: 1; display: grid; place-items: center; align-content: center; gap: 10px; color: var(--muted); }
.empty-state strong { font-size: 1.3rem; color: var(--ink); }

/* ── 3-zone workbench ── */
.workbench { flex: 1; min-height: 0; display: grid; grid-template-columns: 210px 1fr 310px; gap: 0; overflow: hidden; }
.wb-left { border-right: 1px solid var(--line); padding: 8px; overflow-y: auto; background: var(--panel); display: grid; gap: 8px; align-content: start; }
.wb-formulas-toggle summary { cursor: pointer; padding: 6px 8px; border: 1px dashed var(--line); border-radius: 6px; color: var(--muted); font-size: 0.7rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; }
.wb-formulas-toggle summary:hover { border-color: var(--green); color: var(--ink); }
.wb-formulas-toggle[open] summary { color: var(--green); border-style: solid; }
.wb-formulas-toggle[open] { display: grid; gap: 6px; }
.wb-center { display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; min-width: 0; }
.wb-right { border-left: 1px solid var(--line); padding: 8px; overflow-y: auto; background: var(--panel); display: grid; gap: 7px; align-content: start; }

/* ── Center ── */
.wb-chart { flex-shrink: 0; height: 380px; border-bottom: 1px solid var(--line); }
.wb-chart .trading-chart-shell { height: 380px; min-height: 380px; }
.wb-chart .chart-state-strip { padding: 6px 8px; }

.wb-formula { display: grid; gap: 8px; padding: 8px 10px; }
.wf-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.wf-head span { color: var(--green); font-size: 0.64rem; font-weight: 900; letter-spacing: 0.05em; text-transform: uppercase; }
.wf-head strong { display: block; font-size: 0.85rem; font-weight: 700; color: var(--muted); max-width: 400px; }
.wf-params { display: flex; gap: 6px; flex-wrap: wrap; }
.wf-params label { display: grid; gap: 1px; }
.wf-params label span { font-size: 0.6rem; color: var(--muted); }
.wf-params input { width: 80px; border: 1px solid var(--line); border-radius: 4px; padding: 3px 5px; background: var(--bg); color: var(--ink); font-variant-numeric: tabular-nums; font-size: 0.78rem; }
.wf-params select { width: 88px; border: 1px solid var(--line); border-radius: 4px; padding: 3px 3px; background: var(--bg); color: var(--ink); font-size: 0.72rem; font-weight: 700; }

.wf-io { display: grid; gap: 4px; }
.wf-io div { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.wf-io b { color: var(--muted); font-size: 0.68rem; font-weight: 800; text-transform: uppercase; white-space: nowrap; }
.wf-io span { color: var(--ink); font-size: 0.8rem; }
.wf-io code { border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px; background: var(--bg); color: var(--blue); font-size: 0.72rem; }

/* ── Right ── */
.exec-strip { display: grid; gap: 3px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 7px; background: #10120f; color: #fbfaf5; }
.exec-strip span { color: #76c09d; font-size: 0.62rem; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; }
.exec-strip strong { font-size: 1rem; }
.exec-strip em { width: fit-content; border: 1px solid rgba(118,192,157,0.35); border-radius: 999px; padding: 1px 6px; color: #d7eadf; font-style: normal; font-size: 0.64rem; font-weight: 900; }
.exec-strip small { color: #c9c4b8; font-size: 0.72rem; line-height: 1.3; }
.exec-nums { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.exec-nums div { display: grid; gap: 1px; }
.exec-nums strong { font-size: 0.82rem; }

.mode-tabs, .prof-tabs { display: grid; gap: 3px; }
.mode-tabs { grid-template-columns: repeat(3, 1fr); }
.prof-tabs { grid-template-columns: repeat(4, 1fr); }
.mode-tabs button, .prof-tabs button { min-height: 26px; border: 1px solid var(--line); border-radius: 5px; background: var(--bg); color: var(--ink); font-weight: 800; font-size: 0.72rem; }
.mode-tabs button.active, .prof-tabs button.active { border-color: var(--green); background: var(--surface-active); }

.risk-box { display: grid; gap: 2px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); }
.risk-box span { color: var(--green); font-size: 0.62rem; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; }
.green { color: var(--green); }
.red { color: var(--red); }

.cursor-bar { display: flex; justify-content: space-between; padding: 3px 10px; font-size: 0.65rem; color: var(--muted); background: var(--surface-alt); border-bottom: 1px solid var(--line); }
.cursor-bar span:first-child { font-weight: 800; color: var(--green); }
.wb-center .metric-strip { grid-template-columns: repeat(5, minmax(0, 1fr)); padding: 6px 8px; gap: 6px; border-bottom: 1px solid var(--line); }
.wb-center .metric-strip article { padding: 7px 8px; }

@media (max-width: 900px) {
  .workbench { grid-template-columns: 1fr; grid-template-rows: auto 1fr auto; }
  .wb-left { border-right: none; border-bottom: 1px solid var(--line); max-height: 160px; }
  .wb-right { border-left: none; border-top: 1px solid var(--line); }
  .wb-chart { height: 320px; }
}
</style>
