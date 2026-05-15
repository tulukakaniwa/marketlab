import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { buildMarketStatePath } from '../domain/market-data/cost.js'
import { marketSamples } from '../domain/market-data/ohlcv.js'
import { inferTdpy } from '../domain/market-data/tdpy.js'
import { buildResearchSnapshot } from '../domain/formula-research/researchSnapshot.js'
import { buildDecisionGraph } from '../domain/strategy-planning/orderPlan.js'
import { useDataLoader } from '../composables/useDataLoader.js'
import { useMarketState } from '../composables/useMarketState.js'
import { usePlanning, buildExecutionBrief } from '../composables/usePlanning.js'

/**
 * Lab 工作台 facade store
 *
 * 依赖图（线性，无循环）：
 *   planning.input
 *     → data (rows/cursor)
 *     → marketState (market/marketStateFull/costPath/formulaPath)
 *     → effectiveInput → graph → executionBrief
 *
 * 对外 API 面向当前工作台组件；旧回测字段已删除。
 */
export const useLabStore = defineStore('lab', () => {
  // 1. 输入与 UI 状态
  const planning = usePlanning()
  const { input } = planning

  // 2. 数据加载
  const data = useDataLoader(input)
  const { rows, cursor } = data

  // 3. 市场态（带 tdpy 二级缓存）
  const marketState = useMarketState(rows, cursor, input)

  // 4. 决策输入
  //    回测系统已从默认决策链下架，profile 只来自用户手动选择。
  const effectiveInput = computed(() => ({
    ...input,
    strategyProfile: input.strategyProfile,
  }))

  // 5. 默认条件图 + 研究层快照并列组合。
  //    StrategyPlanning 不直接依赖研究层，facade 只为 UI 组装查询模型。
  const planningGraph = computed(() => buildDecisionGraph({
    market: marketState.market.value,
    input: effectiveInput.value,
  }))
  const researchGraph = computed(() => {
    if (!marketState.market.value || !planningGraph.value?.inputs) return null
    return buildResearchSnapshot({
      market: marketState.market.value,
      input: effectiveInput.value,
      executable: planningGraph.value,
    })
  })
  const graph = computed(() => ({
    ...planningGraph.value,
    ...(researchGraph.value ?? {}),
    research: researchGraph.value,
  }))

  const executionBrief = computed(() => buildExecutionBrief(graph.value))

  const sourceLabel = computed(() => data.source.value?.label ?? '未载入')
  // 加载新 rows 时回填输入参数
  watch(rows, (next) => {
    if (!next.length) return
    const tdpy = Number(input.tradingDaysPerYear) || 365
    const lastMarket = buildMarketStatePath(next, tdpy).at(-1)
    if (!lastMarket) return
    input.entryPrice = round(lastMarket.markPrice, 2)
    input.iv = round(lastMarket.annualVol, 4)
    input.strikePrice = round(lastMarket.markPrice * 1.05, 2)
    input.startPrice = round(lastMarket.costAnchor, 2)
    input.perpTwap = round(lastMarket.markPrice, 2)
    input.spotTwap = round(lastMarket.costAnchor, 2)
  })

  function useCursorCloseAsEntry() {
    const close = marketState.activeRows.value.at(-1)?.close
    if (Number.isFinite(close) && close > 0) input.entryPrice = round(close, 2)
  }

  function selectSample(sample) {
    input.tradingDaysPerYear = inferTdpy(sample).value
    return data.loadSample(sample)
  }

  return {
    // 数据层
    rows: data.rows,
    source: data.source,
    loading: data.loading,
    loadingSampleId: data.loadingSampleId,
    error: data.error,
    cursor: data.cursor,
    loadBtcHistory: data.loadBtcHistory,
    loadSample: data.loadSample,
    selectSample,
    retryLast: data.retryLast,
    dismissError: data.dismissError,
    importText: data.importText,
    sourceLabel,
    marketSamples,

    // 市场态层
    activeRows: marketState.activeRows,
    market: marketState.market,
    costPath: marketState.costPath,
    formulaPath: marketState.formulaPath,

    // 决策层
    input: planning.input,
    effectiveInput,
    graph,
    executionBrief,
    activeMode: planning.activeMode,
    activeCapability: planning.activeCapability,
    activeCapabilityId: planning.activeCapabilityId,
    activeCapabilityStages: planning.activeCapabilityStages,
    activeFormula: planning.activeFormula,
    activeFormulaId: planning.activeFormulaId,
    formulaCapabilities: planning.formulaCapabilities,
    strategyProfileList: planning.strategyProfileList,
    selectCapability: planning.selectCapability,

    // 杂项
    useCursorCloseAsEntry,
  }
})

function round(value, digits) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0
}
