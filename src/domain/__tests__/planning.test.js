import { describe, expect, it } from 'vitest'
import { buildMarketStatePath } from '../market/cost.js'
import { buildDecisionGraph, strategyProfileList } from '../planning/orderPlan.js'

function makeRows(n, gen) {
  return Array.from({ length: n }, (_, i) => {
    const close = gen(i)
    return {
      date: `2024-${String(Math.floor(i / 30) + 1).padStart(2, '0')}-${String((i % 30) + 1).padStart(2, '0')}`,
      timestamp: i,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
    }
  })
}

describe('strategyProfileList', () => {
  it('三档顺序固定：保守 / 均衡 / 激进', () => {
    expect(strategyProfileList.map(p => p.id)).toEqual(['conservative', 'balanced', 'aggressive'])
  })
})

describe('buildDecisionGraph', () => {
  const rows = makeRows(120, i => 100 + Math.sin(i / 10) * 5)
  const market = buildMarketStatePath(rows).at(-1)
  const baseInput = {
    entryPrice: market.markPrice,
    holdingDays: 30,
    iv: market.annualVol,
    targetReturn: 0.3,
    capital: 10000,
    baseNotional: 0,
    strategyProfile: 'balanced',
    strikePrice: market.markPrice * 1.05,
    riskFreeRate: 0.04,
    optionType: 'put',
    startPrice: market.costAnchor,
    rangeWidth: 0.1,
    skew: 1,
    liquidity: 1,
    hedgeSize: 0,
    fees: 0,
    perpTwap: market.markPrice,
    spotTwap: market.costAnchor,
  }

  it('返回结构包含 timing/position/plan', () => {
    const g = buildDecisionGraph({ market, input: baseInput })
    expect(['buy', 'sell', null]).toContain(g.decision.timing.side)
    expect(Number.isFinite(g.position.maxNotional)).toBe(true)
    expect(g.plan.primaryOrders.every(o => Number.isFinite(o.price))).toBe(true)
  })

  it('卖出信号在无底仓时不生成挂单', () => {
    const g = buildDecisionGraph({ market, input: baseInput })
    if (g.decision.timing.side === 'sell') {
      expect(g.plan.primaryOrders.length).toBe(0)
    }
  })

  it('保守 vs 激进：风险预算不同', () => {
    const c = buildDecisionGraph({ market, input: { ...baseInput, strategyProfile: 'conservative' } })
    const a = buildDecisionGraph({ market, input: { ...baseInput, strategyProfile: 'aggressive' } })
    if (c.position.side && a.position.side) {
      expect(a.position.riskBudget).toBeGreaterThanOrEqual(c.position.riskBudget)
    }
  })

  it('无市场态返回空图', () => {
    const empty = buildDecisionGraph({ market: null, input: baseInput })
    expect(empty.plan.primaryOrders).toEqual([])
  })
})
