import { computed } from 'vue'
import { getFormulaStage } from '../domain/formulas/registry.js'
import { strategyProfileList } from '../domain/planning/orderPlan.js'
import { persistedReactive, persistedRef } from './usePersisted.js'

/**
 * 输入参数 + UI 选中态层
 *
 * v3.1 改造：删除 activeDrawer 单例；新增 leftPanelOpen / rightPanelOpen / activeLeftTab + toggle
 * v3.2 改造：新增 leftPanelW / rightPanelW（持久化）+ clamp setter + reset
 */
export function usePlanning() {
  const input = persistedReactive('lab.input.v1', {
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
  })

  // 按 symbol 存 tdpy 覆盖值
  const tdpyOverride = persistedReactive('lab.tdpyOverride.v1', {})

  function setTdpyOverride(symbol, value) {
    if (!symbol) return
    if (value === null || !Number.isFinite(value) || value <= 0) {
      delete tdpyOverride[symbol]
      return
    }
    tdpyOverride[symbol] = value
  }

  function clearTdpyOverride(symbol) {
    if (symbol) delete tdpyOverride[symbol]
  }

  const activeFormulaId = persistedRef('lab.activeFormulaId.v1', 'delta-band')
  const activeFormula = computed(() => getFormulaStage(activeFormulaId.value))

  // 三栏面板状态：左/右面板开闭 + 左面板当前 tab
  const leftPanelOpen = persistedRef('lab.leftPanelOpen.v1', true)
  const rightPanelOpen = persistedRef('lab.rightPanelOpen.v1', true)
  const activeLeftTab = persistedRef('lab.activeLeftTab.v1', 'decision')

  function toggleLeftPanel() { leftPanelOpen.value = !leftPanelOpen.value }
  function toggleRightPanel() { rightPanelOpen.value = !rightPanelOpen.value }

  // 面板宽度（v3.2 拖宽）
  const LEFT_MIN  = 200, LEFT_MAX  = 400
  const RIGHT_MIN = 200, RIGHT_MAX = 380
  const LEFT_DEFAULT  = 280
  const RIGHT_DEFAULT = 240

  const leftPanelW  = persistedRef('lab.leftPanelW.v1', LEFT_DEFAULT)
  const rightPanelW = persistedRef('lab.rightPanelW.v1', RIGHT_DEFAULT)

  function setLeftPanelW(w) {
    leftPanelW.value = clamp(w, LEFT_MIN, LEFT_MAX)
  }
  function setRightPanelW(w) {
    rightPanelW.value = clamp(w, RIGHT_MIN, RIGHT_MAX)
  }
  function resetLeftPanelW()  { leftPanelW.value  = LEFT_DEFAULT }
  function resetRightPanelW() { rightPanelW.value = RIGHT_DEFAULT }

  function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min
    return Math.min(max, Math.max(min, Math.round(value)))
  }

  return {
    input,
    tdpyOverride,
    setTdpyOverride,
    clearTdpyOverride,
    activeFormulaId,
    activeFormula,
    strategyProfileList,
    leftPanelOpen,
    rightPanelOpen,
    activeLeftTab,
    toggleLeftPanel,
    toggleRightPanel,
    leftPanelW,
    rightPanelW,
    setLeftPanelW,
    setRightPanelW,
    resetLeftPanelW,
    resetRightPanelW,
  }
}

export function buildExecutionBrief(graph, profile, autoProfile) {
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
