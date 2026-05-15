import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { buildMarketStatePath } from '../domain/market/cost.js'
import { marketSamples } from '../domain/market/ohlcv.js'
import { buildDecisionGraph } from '../domain/planning/orderPlan.js'
import { useDataLoader } from '../composables/useDataLoader.js'
import { useMarketState } from '../composables/useMarketState.js'
import { useReplay } from '../composables/useReplay.js'
import { usePlanning, buildExecutionBrief } from '../composables/usePlanning.js'

/**
 * Lab 工作台 facade store
 *
 * 依赖图（线性，无循环）：
 *   planning.input
 *     → data (rows/cursor)
 *     → marketState (market/marketStateFull/costPath/formulaPath)
 *     → replay (profileReplays/recommendedProfile/replay)
 *     → effectiveInput → graph → executionBrief
 *
 * 对外 API 保持向后兼容：组件 import 路径与字段名不变。
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

  // 4. 回放（复用 marketStateFull，避免重算）
  //    effectiveInput 在更下层组合，但 useReplay 只需 input 与 effectiveInput 的引用，先用占位 computed
  const effectiveInput = computed(() => ({
    ...input,
    strategyProfile: input.autoProfile && replayLayer
      ? replayLayer.recommendedProfile.value.id
      : input.strategyProfile,
  }))
  // 占位（initialize-after-use 模式）：先声明 replayLayer 再初始化
  let replayLayer = useReplay(rows, input, effectiveInput, marketState.marketStateFull)

  // 5. 决策图
  const graph = computed(() => buildDecisionGraph({
    market: marketState.market.value,
    input: effectiveInput.value,
  }))

  const executionBrief = computed(() => buildExecutionBrief(
    graph.value,
    replayLayer.recommendedProfile.value,
    input.autoProfile,
  ))

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

    // 回放层
    profileReplays: replayLayer.profileReplays,
    recommendedProfile: replayLayer.recommendedProfile,
    replay: replayLayer.replay,

    // 杂项
    useCursorCloseAsEntry,
  }
})

function round(value, digits) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0
}
