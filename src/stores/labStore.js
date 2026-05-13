import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import {
  formulaCapabilities,
  getCapabilityStages,
  getFormulaCapability,
  getFormulaStage,
} from '../domain/formulas/registry.js'
import { buildCostPath, buildMarketStatePath } from '../domain/market/cost.js'
import { buildFormulaPath } from '../domain/market/formulaPath.js'
import { btcHistorySource, marketSamples, parseCsvText } from '../domain/market/ohlcv.js'
import { buildDecisionGraph, strategyProfileList } from '../domain/planning/orderPlan.js'
import { buildDailyReplay } from '../domain/replay/dailyReplay.js'

export const useLabStore = defineStore('lab', () => {
  const rows = ref([])
  const source = ref(null)
  const loading = ref(false)
  const loadingSampleId = ref('')
  const error = ref('')
  const cursor = ref(0)
  const activeMode = ref('orders')
  const activeCapabilityId = ref('move-derivative')
  const activeFormulaId = ref('delta-band')

  const input = reactive({
    entryPrice: 0,
    holdingDays: 30,
    iv: 0,
    targetReturn: 0.3,
    capital: 10000,
    baseNotional: 0,
    autoProfile: true,
    strategyProfile: 'balanced',
    strikePrice: 0,
    riskFreeRate: 0.04,
    optionType: 'put',
    startPrice: 0,
    rangeWidth: 0.1,
    skew: 1,
    liquidity: 1,
    hedgeSize: 0,
    fees: 0,
    perpTwap: 0,
    spotTwap: 0,
    pathUsesScenarioInputs: false,
    replayFeeRate: 0.001,
    tradingDaysPerYear: 365,
  })

  const marketStatePathCache = new WeakMap()
  function getMarketStatePath(r) { if (!marketStatePathCache.has(r)) marketStatePathCache.set(r, buildMarketStatePath(r, Number(input.tradingDaysPerYear) || 365)); return marketStatePathCache.get(r) }
  const activeRows = computed(() => rows.value.slice(0, cursor.value + 1))
  const marketStateFull = computed(() => rows.value.length ? getMarketStatePath(rows.value) : [])
  const market = computed(() => marketStateFull.value[cursor.value] ?? null)
  const costPath = computed(() => buildCostPath(rows.value))
  const formulaPath = computed(() => buildFormulaPath(rows.value, input))
  const profileReplays = computed(() => strategyProfileList.map((profile) => ({
    profile,
    replay: buildDailyReplay(rows.value, { ...input, strategyProfile: profile.id }),
  })))
  const recommendedProfile = computed(() => chooseProfile(profileReplays.value, Number(input.capital) + Number(input.baseNotional || 0)))
  const effectiveInput = computed(() => ({
    ...input,
    strategyProfile: input.autoProfile ? recommendedProfile.value.id : input.strategyProfile,
  }))
  const graph = computed(() => buildDecisionGraph({ market: market.value, input: effectiveInput.value }))
  const replay = computed(() => buildDailyReplay(rows.value, effectiveInput.value))
  const executionBrief = computed(() => buildExecutionBrief(graph.value, recommendedProfile.value, input.autoProfile))
  const activeCapability = computed(() => getFormulaCapability(activeCapabilityId.value))
  const activeCapabilityStages = computed(() => getCapabilityStages(activeCapabilityId.value))
  const activeFormula = computed(() => getFormulaStage(activeFormulaId.value))
  const sourceLabel = computed(() => source.value?.label ?? '未载入')
  let loadTicket = 0

  async function loadBtcHistory() {
    await loadSample(btcHistorySource)
  }

  async function loadSample(sample) {
    const ticket = ++loadTicket
    loading.value = true
    loadingSampleId.value = sample.id
    error.value = ''
    try {
      const response = await fetch(sample.url)
      if (!response.ok) throw new Error(`数据读取失败：${response.status}`)
      const nextRows = parseCsvText(await response.text())
      if (ticket === loadTicket) applyRows(nextRows, sample)
    } catch (caught) {
      if (ticket === loadTicket) error.value = caught.message || '载入失败'
    } finally {
      if (ticket === loadTicket) {
        loading.value = false
        loadingSampleId.value = ''
      }
    }
  }

  function importText(text, label = '导入 CSV') {
    try {
      applyRows(parseCsvText(text), { label, source: '用户导入' })
    } catch (caught) {
      error.value = caught.message || '解析失败'
    }
  }

  function applyRows(nextRows, nextSource) {
    if (!nextRows.length) throw new Error('没有可用 K 线')
    rows.value = nextRows
    source.value = {
      ...nextSource,
      range: `${nextRows[0].date} ~ ${nextRows.at(-1).date}`,
    }
    cursor.value = nextRows.length - 1
    const nextMarket = (buildMarketStatePath(nextRows, Number(input.tradingDaysPerYear) || 365)).at(-1)
    if (nextMarket) {
      input.entryPrice = round(nextMarket.markPrice, 2)
      input.iv = round(nextMarket.annualVol, 4)
      input.strikePrice = round(nextMarket.markPrice * 1.05, 2)
      input.startPrice = round(nextMarket.costAnchor, 2)
      input.perpTwap = round(nextMarket.markPrice, 2)
      input.spotTwap = round(nextMarket.costAnchor, 2)
    }
  }

  function useCursorCloseAsEntry() {
    const close = activeRows.value.at(-1)?.close
    if (Number.isFinite(close) && close > 0) input.entryPrice = round(close, 2)
  }

  function selectCapability(id) {
    activeCapabilityId.value = id
    activeFormulaId.value = getCapabilityStages(id)[0]?.id ?? activeFormulaId.value
  }

  return {
    activeMode,
    activeCapability,
    activeCapabilityId,
    activeCapabilityStages,
    activeFormula,
    activeFormulaId,
    activeRows,
    costPath,
    cursor,
    error,
    formulaCapabilities,
    formulaPath,
    graph,
    importText,
    input,
    effectiveInput,
    executionBrief,
    loadBtcHistory,
    loadSample,
    loading,
    loadingSampleId,
    market,
    marketSamples,
    rows,
    replay,
    recommendedProfile,
    source,
    sourceLabel,
    selectCapability,
    profileReplays,
    strategyProfileList,
    useCursorCloseAsEntry,
  }
})

function round(value, digits) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0
}

function chooseProfile(items, capital) {
  if (!items.length) return strategyProfileList[1]
  const accountSize = Math.max(capital || 0, 1)
  const scored = items.map((item) => {
    const replay = item.replay
    const drawdownPenalty = Math.abs(replay.maxDrawdown || 0) / accountSize
    const turnoverPenalty = Math.max(replay.tradeCount - 36, 0) * 0.0008
    const emptyPenalty = replay.tradeCount ? 0 : 0.01
    return {
      profile: item.profile,
      score: (replay.returnOnUsedNotional || 0) - drawdownPenalty * 0.85 - turnoverPenalty - emptyPenalty,
    }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.profile ?? strategyProfileList[1]
}

function buildExecutionBrief(graph, profile, autoProfile) {
  const state = graph?.decision?.state ?? '未载入路径'
  const orders = graph?.plan?.primaryOrders ?? []
  const side = graph?.position?.side
  const verb = side === 'buy' ? '低价买入' : side === 'sell' && orders.length ? '底仓减压' : '等待低价'
  const firstOrder = orders[0]
  const bias = side === 'buy'
    ? '主策略：安全低价买入'
    : side === 'sell'
      ? '卖出只做仓位保护'
      : '主策略等待低价，不追高'
  return {
    title: verb === state ? state : `${verb} · ${state}`,
    bias,
    profileLabel: autoProfile ? `自动选择 ${profile?.label ?? '均衡'}` : `手动 ${graph?.profile?.label ?? '均衡'}`,
    price: firstOrder?.price ?? null,
    notional: firstOrder?.notional ?? 0,
    stop: graph?.position?.stopPrice ?? null,
    target: graph?.position?.targetPrice ?? null,
    reason: graph?.decision?.timing?.reason ?? graph?.position?.rule ?? '等待真实 K 线。',
  }
}
