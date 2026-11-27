import { describe, expect, it } from 'vitest'
import { buildMarketStatePath } from '../market-data/cost.js'
import { buildDecisionGraph } from '../strategy-planning/orderPlan.js'

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
  momentumFast: 0.03,
  momentumSlow: 0.01,
  costSlopeRecent: 0,
}

describe('buildDecisionGraph profiles, equity scaling, and research isolation', () => {
  const rows = makeRows(120, (i) => 100 + Math.sin(i / 10) * 5)
  const market = buildMarketStatePath(rows, 252).at(-1)
  const baseInput = {
    entryPrice: market.markPrice,
    formulaHorizonSessions: 13,
    formulaHorizonState: {
      context: {
        mode: 'formula-derived',
        side: 'long',
        cycleStartPrice: 90,
        anchorPrice: 100,
        targetPrice: 95,
        targetSource: 'adaptive-cost-lower',
        halfLifeSessions: 13,
        availableAt: 'test:close',
        executionAuthority: 'none',
      },
    },
    iv: market.annualVol,
    deltaSlope: 0.3,
    exitTargetReturn: 0,
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
    tradingDaysPerYear: 252,
    dynamicHoldingGate: {
      status: '观察',
      candidateStatus: '观察',
      phase: 'repair-start',
      phaseLabel: '修复启动',
      blockedReasons: [],
      executionAuthority: 'none',
    },
  }

  it('回测账户按当前权益缩放仓位，不继续用启动本金放大风险', () => {
    const g = buildDecisionGraph({
      market: buyMarket,
      input: { ...baseInput, capital: 10000, entryPrice: 100, iv: 0.4 },
      account: { cash: 2000, base: 0, costBasis: 0 },
    })
    expect(g.decision.timing.side).toBe('buy')
    expect(g.account.equity).toBe(2000)
    expect(g.position.maxNotional).toBeLessThanOrEqual(2000 * g.profile.exposureMax + 1e-9)
  })

  it('研究层 LP/funding 输入不改变默认挂单价格', () => {
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
    expect(changed.research).toBeUndefined()
    expect(changed.portfolio).toBeUndefined()
    expect(changed.portfolioResearch).toBeUndefined()
    expect(changed.plan.primaryOrders.map((o) => o.price)).toEqual(base.plan.primaryOrders.map((o) => o.price))
    expect(changed.plan.primaryOrders.map((o) => o.notional)).toEqual(base.plan.primaryOrders.map((o) => o.notional))
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

  it('自定义策略参数进入领域层并改变风险预算', () => {
    const small = buildDecisionGraph({
      market: buyMarket,
      input: {
        ...baseInput,
        entryPrice: 100,
        iv: 0.4,
        strategyProfile: 'custom',
        strategyRiskPct: 0.005,
        strategyExposurePct: 0.1,
      },
    })
    const large = buildDecisionGraph({
      market: buyMarket,
      input: {
        ...baseInput,
        entryPrice: 100,
        iv: 0.4,
        strategyProfile: 'custom',
        strategyRiskPct: 0.04,
        strategyExposurePct: 0.8,
      },
    })
    expect(small.profile.id).toBe('custom')
    expect(large.profile.riskMax).toBeGreaterThan(small.profile.riskMax)
    expect(large.position.maxNotional).toBeGreaterThan(small.position.maxNotional)
  })

  it('无市场态返回空图', () => {
    const empty = buildDecisionGraph({ market: null, input: baseInput })
    expect(empty.plan.primaryOrders).toEqual([])
  })
})
