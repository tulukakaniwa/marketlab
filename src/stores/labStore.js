import { defineStore } from 'pinia'
import { computed, watch } from 'vue'
import { buildMarketStatePath } from '../domain/market/cost.js'
import { inferTdpy } from '../domain/market/tdpy.js'
import { marketSamples } from '../domain/market/ohlcv.js'
import { buildDecisionGraph } from '../domain/planning/orderPlan.js'
import { useDataLoader } from '../composables/useDataLoader.js'
import { useMarketState } from '../composables/useMarketState.js'
import { useReplay } from '../composables/useReplay.js'
import { usePlanning, buildExecutionBrief } from '../composables/usePlanning.js'
import { useChartOverlays } from '../composables/useChartOverlays.js'

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

  // 3. tdpy：按品种自动 + 用户覆盖
  const tdpyMeta = computed(() => inferTdpy(data.source.value))
  const effectiveTdpy = computed(() => {
    const sym = data.source.value?.symbol
    const override = sym ? planning.tdpyOverride[sym] : null
    return Number.isFinite(override) && override > 0 ? override : tdpyMeta.value.value
  })

  // 4. effectiveInput：合并 tdpy + auto profile（initialize-after-use 模式：先声明便于下游引用）
  const effectiveInput = computed(() => ({
    ...input,
    tradingDaysPerYear: effectiveTdpy.value,
    strategyProfile: input.autoProfile && replayLayer
      ? replayLayer.recommendedProfile.value.id
      : input.strategyProfile,
  }))

  // 5. 市场态（吃 effectiveInput，确保 tdpy 自动跟随）
  const marketState = useMarketState(rows, cursor, effectiveInput)

  // 6. 回放（复用 marketStateFull）
  let replayLayer = useReplay(rows, input, effectiveInput, marketState.marketStateFull)

  // 7. 决策图
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

  // 加载新 rows 时回填输入参数（用 effectiveTdpy 而非 input.tradingDaysPerYear）
  watch(rows, (next) => {
    if (!next.length) return
    const tdpy = effectiveTdpy.value
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

  // chartOverlays 在 store 顶层初始化一次（同一份在所有组件间共享）
  const chartOverlays = useChartOverlays()

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

    // tdpy 层（PR-1）
    tdpyMeta,
    effectiveTdpy,
    setTdpyOverride: planning.setTdpyOverride,
    clearTdpyOverride: planning.clearTdpyOverride,
    tdpyOverride: planning.tdpyOverride,

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
    activeFormula: planning.activeFormula,
    activeFormulaId: planning.activeFormulaId,
    strategyProfileList: planning.strategyProfileList,

    // 三栏面板态 + 主图叠加（v3.1）+ 面板宽度（v3.2）
    leftPanelOpen: planning.leftPanelOpen,
    rightPanelOpen: planning.rightPanelOpen,
    activeLeftTab: planning.activeLeftTab,
    toggleLeftPanel: planning.toggleLeftPanel,
    toggleRightPanel: planning.toggleRightPanel,
    leftPanelW: planning.leftPanelW,
    rightPanelW: planning.rightPanelW,
    setLeftPanelW: planning.setLeftPanelW,
    setRightPanelW: planning.setRightPanelW,
    resetLeftPanelW: planning.resetLeftPanelW,
    resetRightPanelW: planning.resetRightPanelW,
    chartOverlays,

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
