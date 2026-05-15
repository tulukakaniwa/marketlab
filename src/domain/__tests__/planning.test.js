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
  const noAccountInput = {
    ...baseInput,
    capital: 0,
    baseNotional: 0,
  }

  it('返回结构包含 timing/position/plan', () => {
    const g = buildDecisionGraph({ market, input: baseInput })
    expect(['buy', 'sell', null]).toContain(g.decision.timing.side)
    expect(g.decision.triggeredConditions).toBeDefined()
    expect(g.decision.blockedReasons).toBeDefined()
    expect(g.decision.missingInputs).toBeDefined()
    expect(g.plan.primaryOrders.every(o => Number.isFinite(o.price))).toBe(true)
  })

  it('折价 + 动量止跌时使用市场缩放 profile 生成买入挂单', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
    }
    const g = buildDecisionGraph({ market: buyMarket, input: { ...baseInput, entryPrice: 100, iv: 0.4 } })
    expect(g.profile.minEdge).toBeGreaterThan(0)
    expect(g.profile.riskMin).toBeGreaterThan(0)
    expect(g.decision.timing.side).toBe('buy')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    expect(g.plan.primaryOrders.every(o => o.side === 'buy')).toBe(true)
  })

  it('无账户资金输入时不生成名义金额和候选订单', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
    }
    const g = buildDecisionGraph({ market: buyMarket, input: { ...noAccountInput, entryPrice: 100, iv: 0.4 } })
    expect(g.decision.timing.side).toBe('buy')
    expect(g.position.maxNotional).toBeNull()
    expect(g.position.riskBudget).toBeNull()
    expect(g.decision.missingInputs).toContain('account.capital')
    expect(g.plan.primaryOrders).toEqual([])
  })

  it('未触发默认条件时仍暴露账户资金缺口', () => {
    const g = buildDecisionGraph({ market, input: noAccountInput })
    expect(g.plan.primaryOrders).toEqual([])
    expect(g.position.maxNotional).toBeNull()
    expect(g.decision.missingInputs).toContain('account.capital')
  })

  it('有底仓溢价时使用市场缩放 profile 生成减仓挂单', () => {
    const sellMarket = {
      rows: 120,
      markPrice: 110,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: 0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentum5: 0,
      momentum20: 0,
      costSlope5: 0,
    }
    const g = buildDecisionGraph({ market: sellMarket, input: { ...baseInput, entryPrice: 110, iv: 0.4, baseNotional: 10000 } })
    expect(g.profile.exposureMax).toBeGreaterThan(0)
    expect(g.decision.timing.side).toBe('sell')
    expect(g.plan.primaryOrders.length).toBeGreaterThan(0)
    expect(g.plan.primaryOrders.every(o => o.side === 'sell')).toBe(true)
  })

  it('研究层 LP/funding 输入不改变默认挂单价格', () => {
    const buyMarket = {
      rows: 120,
      markPrice: 90,
      costAnchor: 100,
      costRecent: 100,
      costLow: 95,
      costHigh: 105,
      costDistance: -0.1,
      annualVol: 0.4,
      atrPercent: 0.02,
      momentum5: 0.03,
      momentum20: 0.01,
      costSlope5: 0,
    }
    const executableInput = { ...baseInput, entryPrice: 100, iv: 0.4 }
    const researchChangedInput = {
      ...executableInput,
      startPrice: 40,
      rangeWidth: 0.5,
      skew: 3,
      liquidity: 999,
      hedgeSize: 12,
      fees: 42,
      perpTwap: 130,
      spotTwap: 75,
      dividendYield: 0.12,
      fingerprintLambda: 9,
      fingerprintKappa: 0.25,
      numoenR1: 12,
      numoenDy: 0.4,
    }
    const base = buildDecisionGraph({ market: buyMarket, input: executableInput })
    const changed = buildDecisionGraph({ market: buyMarket, input: researchChangedInput })
    expect(changed.research).toBeTruthy()
    expect(changed.portfolio).toBeUndefined()
    expect(changed.portfolioResearch.status).toBe('research-only')
    expect(changed.research.numoen.status).toBe('protocol-unverified')
    expect(changed.research.liquidityFingerprint.segments.reduce((sum, seg) => sum + seg.weight, 0)).toBeCloseTo(1, 5)
    expect(changed.plan.primaryOrders.map(o => o.price)).toEqual(base.plan.primaryOrders.map(o => o.price))
    expect(changed.plan.primaryOrders.map(o => o.notional)).toEqual(base.plan.primaryOrders.map(o => o.notional))
  })

  it('卖出信号在无底仓时不生成挂单', () => {
    const g = buildDecisionGraph({ market, input: baseInput })
    if (g.decision.timing.side === 'sell') {
      expect(g.plan.primaryOrders.length).toBe(0)
    }
  })

  it('保守 vs 激进：账户输入存在时风险预算不同', () => {
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
