import { computed } from 'vue'
import {
  formulaCapabilities,
  getCapabilityStages,
  getFormulaCapability,
  getFormulaStage,
} from '../domain/formulas/registry.js'
import { strategyProfileList } from '../domain/planning/orderPlan.js'
import { persistedReactive, persistedRef } from './usePersisted.js'

/**
 * 输入参数 + UI 选中态层
 *
 * input 与 UI 选中态都通过 localStorage 持久化（key 带版本号）。
 * 字段升级时仅合并已知 key，不被旧数据污染。
 */
export function usePlanning() {
  const input = persistedReactive('lab.input.v1', {
    entryPrice: 0,
    holdingDays: 30,
    iv: 0,
    targetReturn: 0.3,
    capital: 10000,
    baseNotional: 0,
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
    tradingDaysPerYear: 365,
  })

  const activeMode = persistedRef('lab.activeMode.v1', 'orders')
  const activeCapabilityId = persistedRef('lab.activeCapabilityId.v1', 'move-derivative')
  const activeFormulaId = persistedRef('lab.activeFormulaId.v1', 'delta-band')

  const activeCapability = computed(() => getFormulaCapability(activeCapabilityId.value))
  const activeCapabilityStages = computed(() => getCapabilityStages(activeCapabilityId.value))
  const activeFormula = computed(() => getFormulaStage(activeFormulaId.value))

  function selectCapability(id) {
    activeCapabilityId.value = id
    activeFormulaId.value = getCapabilityStages(id)[0]?.id ?? activeFormulaId.value
  }

  return {
    input,
    activeMode,
    activeCapabilityId,
    activeFormulaId,
    activeCapability,
    activeCapabilityStages,
    activeFormula,
    formulaCapabilities,
    strategyProfileList,
    selectCapability,
  }
}

export function buildExecutionBrief(graph) {
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
    profileLabel: `手动 ${graph?.profile?.label ?? '均衡'}`,
    price: firstOrder?.price ?? null,
    notional: firstOrder?.notional ?? 0,
    stop: graph?.position?.stopPrice ?? null,
    target: graph?.position?.targetPrice ?? null,
    reason: graph?.decision?.timing?.reason ?? graph?.position?.rule ?? '等待真实 K 线。',
    confidence: Math.round((graph?.decision?.confidence ?? 0) * 100),
  }
}
