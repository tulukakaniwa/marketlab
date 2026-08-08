import { describe, expect, it } from 'vitest'
import {
  asianOption,
  bachelierOption,
  blackScholes,
  buildOptionPortfolio,
  deviationScore,
  deriveDrawdownFeatures,
  deriveDynamicHoldingState,
  deriveShortHoldWindow,
  deriveStructuralHoldWindow,
  getDeltaBands,
  integrateTrapezoid,
  lambertW,
  liquidityFingerprint,
  logLaplaceDensity,
  numoenSnapshot,
  normalCdf,
  optionLegsFromTemplate,
} from '../formulas/core.js'

describe('normalCdf', () => {
  it('返回 0~1 区间', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 3)
    expect(normalCdf(2)).toBeGreaterThan(0.97)
    expect(normalCdf(-2)).toBeLessThan(0.03)
  })
  it('处理无穷', () => {
    expect(normalCdf(Infinity)).toBe(1)
    expect(normalCdf(-Infinity)).toBe(0)
  })
})

describe('deviationScore probability semantics', () => {
  it('只输出正态参考极端度与双尾质量，不伪造均值回归概率', () => {
    const score = deviationScore({ costDistance: -0.04, annualVol: 0.3, holdingDays: 20, tradingDaysPerYear: 252 })
    expect(score.deviationPercentile).toBeGreaterThan(0)
    expect(score.twoSidedTailProbability).toBeCloseTo(1 - score.deviationPercentile, 10)
    expect(score.probabilitySemantics).toContain('not-mean-reversion-probability')
    expect(score).not.toHaveProperty('regressionProb')
  })
})

describe('deriveShortHoldWindow', () => {
  it('用 z 与半衰期推导 T+1 短线可执行窗口', () => {
    const window = deriveShortHoldWindow({
      zScore: -2.1,
      halfLifeDays: 10,
      costDistance: -0.1105,
      recoveryFraction: 0.2,
      maxHoldingDays: 5,
    })

    expect(window.eligible).toBe(true)
    expect(window.partialRecoveryDays).toBeCloseTo(3.22, 2)
    expect(window.expectedGrossReturn).toBeCloseTo(0.0221, 4)
    expect(window.executableHoldingDays).toBeGreaterThanOrEqual(2)
  })

  it('拒绝 z 不够深或一周内回补不足的短线候选', () => {
    expect(deriveShortHoldWindow({ zScore: -1.1, halfLifeDays: 3 })?.blockedReasons).toContain('z-threshold')
    expect(deriveShortHoldWindow({ zScore: -2.4, halfLifeDays: 31.5 })?.blockedReasons).toContain('holding-window')
    expect(deriveShortHoldWindow({ zScore: -2.1, halfLifeDays: 10, costDistance: -0.01 })?.blockedReasons).toContain(
      'gross-return',
    )
  })

  it('保留完整回到 zExit 的理论时间用于对照', () => {
    const window = deriveShortHoldWindow({ zScore: -2.4, halfLifeDays: 2.5, recoveryFraction: 0.2, minGrossReturn: 0 })
    expect(window.daysToZExit).toBeCloseTo(3.16, 2)
  })

  it('用入场价到结构目标的距离推导持仓周期', () => {
    const window = deriveStructuralHoldWindow({
      zScore: -2.6,
      halfLifeDays: 8,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
      minGrossReturn: 0.03,
      maxHoldingDays: 6,
    })

    expect(window.eligible).toBe(true)
    expect(window.selected.id).toBe('costLower')
    expect(window.selected.recoveryFraction).toBeCloseTo(0.4, 6)
    expect(window.selected.partialRecoveryDays).toBeCloseTo(5.9, 1)
    expect(window.selected.grossReturn).toBeCloseTo(0.0444, 3)
  })

  it('锚点作为近锚目标处理，LP上沿越过锚点时标记为扩展目标', () => {
    const window = deriveStructuralHoldWindow({
      zScore: -3,
      halfLifeDays: 5,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { anchor: 100, lpUpper: 104 },
      minGrossReturn: 0.03,
      maxHoldingDays: 20,
    })

    expect(window.selected.id).toBe('anchor')
    expect(window.selected.isAnchorProxy).toBe(true)
    expect(window.selected.recoveryFraction).toBeCloseTo(0.875, 6)
    expect(window.candidates.find((item) => item.id === 'lpUpper').blockedReasons).toContain('post-anchor-extension')
  })
})

describe('deriveDynamicHoldingState', () => {
  const repairDrawdown = {
    status: 'ok',
    drawdownDepth: -0.22,
    drawdownSpeed5: 0.002,
    drawdownSpeed20: 0.04,
    drawdownRepair: 0.22,
    drawdownAge: { peakDays: 58, troughDays: 6 },
  }

  it('回撤继续扩张时，即使 z/LP 很强也输出等待', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3.2,
      halfLifeDays: 6,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
      lpPercentile: 1,
      drawdown: { ...repairDrawdown, drawdownSpeed5: -0.03, drawdownSpeed20: -0.08 },
    })

    expect(state.status).toBe('等待')
    expect(state.phase).toBe('falling-expansion')
    expect(state.holdingPlan.shortTrade.blockedReasons).toContain('drawdown-expanding')
  })

  it('修复启动时允许 costLower 和 nearAnchor 进入候选里程碑', () => {
    const state = deriveDynamicHoldingState({
      zScore: -2.8,
      halfLifeDays: 6,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 103 },
      costSlopePct: 0,
      drawdown: repairDrawdown,
    })

    expect(state.status).toBe('观察')
    expect(state.phase).toBe('repair-start')
    expect(state.milestones.map((item) => item.id)).toEqual(['firstRepair', 'baseAnchor', 'stretch'])
    expect(state.holdingPlan.shortTrade.targetId).toBe('firstRepair')
    expect(state.expectation.profileExpectations.shortTrade.expectedReturnAtMaxPct).toBeGreaterThan(
      state.expectation.profileExpectations.shortTrade.expectedReturnAtMinPct,
    )
    expect(state.expectation.profileExpectations.fundCycle.expectedReturnAtMinPct).toBeGreaterThan(
      state.expectation.profileExpectations.shortTrade.expectedReturnAtMaxPct,
    )
    expect(state.expectation.profileExpectations.fundCycle.monthlyEfficiencyPct).toBeGreaterThan(0)
  })

  it('costLower 超过短线最大周期时，短线等待但基金周期可观察 nearAnchor', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3.1,
      halfLifeDays: 20,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 104 },
      drawdown: repairDrawdown,
      profiles: {
        shortTrade: { minDays: 2, maxDays: 10, minGrossReturn: 0.03 },
        fundCycle: { minDays: 20, maxDays: 120, minGrossReturn: 0.03 },
      },
    })

    expect(state.holdingPlan.shortTrade.status).toBe('等待')
    expect(state.holdingPlan.shortTrade.blockedReasons).toContain('holding-window')
    expect(state.holdingPlan.fundCycle.status).toBe('观察')
    expect(state.holdingPlan.fundCycle.action).toBe('review')
    expect(state.holdingPlan.fundCycle.targetId).toBe('baseAnchor')
    expect(state.holdingPlan.fundCycle.expectedDays).toBeGreaterThanOrEqual(20)
    expect(state.holdingPlan.fundCycle.expectedDays).toBeLessThanOrEqual(120)
  })

  it('lpUpper 超过锚点时标记为 post-anchor-extension 且不作为默认短线退出', () => {
    const state = deriveDynamicHoldingState({
      zScore: -3,
      halfLifeDays: 5,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100, lpUpper: 104 },
      drawdown: repairDrawdown,
    })

    const stretch = state.milestones.find((item) => item.id === 'stretch')
    expect(stretch.blockedReasons).toContain('post-anchor-extension')
    expect(state.holdingPlan.shortTrade.targetId).not.toBe('stretch')
  })

  it('数据不足时输出需刷新数据和 insufficient-history', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({ close: 100 - index }))
    const drawdown = deriveDrawdownFeatures({ rows })
    const state = deriveDynamicHoldingState({
      zScore: -2,
      halfLifeDays: 5,
      entryPrice: 90,
      anchorPrice: 100,
      targetPrices: { costLower: 94, anchor: 100 },
      drawdown,
    })

    expect(drawdown.status).toBe('insufficient-history')
    expect(state.status).toBe('需刷新数据')
    expect(state.phase).toBe('insufficient-history')
  })
})

describe('getDeltaBands', () => {
  it('多空带都是 low < cost < high', () => {
    const b = getDeltaBands({ entryPrice: 100, holdingDays: 30, iv: 1, targetReturn: 0.3 })
    expect(b.long.low).toBeLessThan(b.long.cost)
    expect(b.long.cost).toBeLessThan(b.long.high)
    expect(b.short.low).toBeLessThan(b.short.cost)
    expect(b.short.cost).toBeLessThan(b.short.high)
  })
  it('保留原式语义：T 是持仓时间，d 是 g(P) 的局部斜率约束', () => {
    const b = getDeltaBands({ entryPrice: 100, holdingDays: 30, iv: 0.4, targetReturn: 0.3 })
    expect(b.sourceId).toBe('943334771f')
    expect(b.variables.T).toBe(30)
    expect(b.variables.d).toBe(0.3)
    expect(b.long.localSlopeAtEntry).toBeCloseTo(0.3, 8)
    expect(Number.isFinite(b.long.payoffAtEntry)).toBe(true)
  })
  it('非法参数返回 null', () => {
    expect(getDeltaBands({ entryPrice: 0, holdingDays: 30, iv: 1, targetReturn: 0.3 })).toBeNull()
    expect(getDeltaBands({ entryPrice: 100, holdingDays: -1, iv: 1, targetReturn: 0.3 })).toBeNull()
  })
  it('波动率 e_T 接近 1 时拒绝（公式失稳）', () => {
    expect(getDeltaBands({ entryPrice: 100, holdingDays: 365, iv: 5, targetReturn: 0.3 })).toBeNull()
  })
  it('tradingDaysPerYear 影响价格带宽度', () => {
    const a = getDeltaBands({ entryPrice: 100, holdingDays: 30, iv: 0.4, targetReturn: 0.1, tradingDaysPerYear: 365 })
    const b = getDeltaBands({ entryPrice: 100, holdingDays: 30, iv: 0.4, targetReturn: 0.1, tradingDaysPerYear: 252 })
    expect(a.long.high).not.toBeCloseTo(b.long.high, 1)
  })
})

describe('blackScholes', () => {
  it('匹配标准 Black-Scholes call benchmark', () => {
    const o = blackScholes({
      entryPrice: 100,
      strikePrice: 100,
      holdingDays: 365,
      iv: 0.2,
      riskFreeRate: 0.05,
      type: 'call',
    })
    expect(o.price).toBeCloseTo(10.4506, 2)
    expect(o.delta).toBeCloseTo(0.6368, 2)
    expect(Number.isFinite(o.rho)).toBe(true)
    expect(Number.isFinite(o.thetaDaily)).toBe(true)
    expect(Number.isFinite(o.thetaAnnual)).toBe(true)
  })
  it('看跌的 delta 在 [-1, 0]', () => {
    const o = blackScholes({
      entryPrice: 100,
      strikePrice: 100,
      holdingDays: 30,
      iv: 0.4,
      riskFreeRate: 0.04,
      type: 'put',
    })
    expect(o.delta).toBeLessThanOrEqual(0)
    expect(o.delta).toBeGreaterThanOrEqual(-1)
    expect(o.gamma).toBeGreaterThan(0)
    expect(o.rho).toBeLessThanOrEqual(0)
  })
  it('看涨的 delta 在 [0, 1]', () => {
    const o = blackScholes({
      entryPrice: 100,
      strikePrice: 100,
      holdingDays: 30,
      iv: 0.4,
      riskFreeRate: 0.04,
      type: 'call',
    })
    expect(o.delta).toBeGreaterThanOrEqual(0)
    expect(o.delta).toBeLessThanOrEqual(1)
    expect(o.rho).toBeGreaterThanOrEqual(0)
  })
})

describe('Asian / Bachelier research formulas', () => {
  it('输出有限研究值并拒绝非法参数', () => {
    const asian = asianOption({
      entryPrice: 100,
      strikePrice: 105,
      holdingDays: 30,
      iv: 0.4,
      riskFreeRate: 0.02,
      type: 'put',
    })
    const bach = bachelierOption({
      entryPrice: 100,
      strikePrice: 105,
      holdingDays: 30,
      normalVol: 40,
      riskFreeRate: 0.02,
      type: 'put',
    })
    expect(Number.isFinite(asian.price)).toBe(true)
    expect(Number.isFinite(asian.gamma)).toBe(true)
    expect(Number.isFinite(bach.price)).toBe(true)
    expect(Number.isFinite(bach.gamma)).toBe(true)
    expect(asianOption({ entryPrice: 0, strikePrice: 105, holdingDays: 30, iv: 0.4 })).toBeNull()
    expect(bachelierOption({ entryPrice: 100, strikePrice: 105, holdingDays: 30, normalVol: 0 })).toBeNull()
  })
})

describe('Option portfolio research model', () => {
  it('支持多腿组合并聚合 Greeks', () => {
    const legs = optionLegsFromTemplate({
      strategy: 'straddle',
      side: 'long',
      entryPrice: 100,
      strikePrice: 100,
      quantity: 2,
    })
    const combo = buildOptionPortfolio({
      entryPrice: 100,
      holdingDays: 30,
      iv: 0.3,
      riskFreeRate: 0.02,
      legs,
    })
    expect(combo.status).toBe('research-only')
    expect(combo.legs).toHaveLength(2)
    expect(Number.isFinite(combo.delta)).toBe(true)
    expect(combo.gamma).toBeGreaterThan(0)
    expect(combo.points.length).toBeGreaterThan(20)
  })

  it('价差组合允许 long/short legs 抵消部分风险', () => {
    const legs = optionLegsFromTemplate({
      strategy: 'vertical',
      side: 'long',
      optionType: 'call',
      entryPrice: 100,
      strikePrice: 100,
      strikePrice2: 110,
    })
    const combo = buildOptionPortfolio({ entryPrice: 100, holdingDays: 45, iv: 0.25, legs })
    expect(combo.legs.map((item) => item.side)).toEqual(['long', 'short'])
    expect(Math.abs(combo.delta)).toBeLessThan(1)
    expect(combo.scope).toContain('LP replication only')
  })

  it('空权利金保持 missing，显式零仍是输入值', () => {
    const missing = buildOptionPortfolio({
      entryPrice: 100,
      holdingDays: 30,
      iv: 0.3,
      legs: [{ type: 'put', side: 'long', strikePrice: 100, quantity: 1, premium: null }],
    })
    const explicitZero = buildOptionPortfolio({
      entryPrice: 100,
      holdingDays: 30,
      iv: 0.3,
      legs: [{ type: 'put', side: 'long', strikePrice: 100, quantity: 1, premium: 0 }],
    })
    expect(missing.missingInputs).toContain('option-leg-premium')
    expect(missing.legs[0].premiumSource).toBe('model')
    expect(explicitZero.missingInputs).not.toContain('option-leg-premium')
    expect(explicitZero.legs[0].premiumSource).toBe('input')
    expect(explicitZero.entryCost).toBe(0)
  })

  it('市场 IV 标签必须有独立来源校验才成立', () => {
    const args = {
      entryPrice: 100,
      holdingDays: 30,
      iv: 0.3,
      volatilitySource: 'market-option-quote-implied',
      legs: [{ type: 'put', side: 'long', strikePrice: 100, quantity: 1, premium: 4 }],
    }
    const unverified = buildOptionPortfolio(args)
    const verified = buildOptionPortfolio({ ...args, volatilitySourceVerified: true })

    expect(unverified.isMarketIv).toBe(false)
    expect(unverified.missingInputs).toContain('verified-market-iv-source')
    expect(verified.isMarketIv).toBe(true)
    expect(verified.missingInputs).not.toContain('verified-market-iv-source')
  })

  it('非法或空 legs 返回 null', () => {
    expect(buildOptionPortfolio({ entryPrice: 100, holdingDays: 30, iv: 0.2, legs: [] })).toBeNull()
    expect(
      buildOptionPortfolio({
        entryPrice: 0,
        holdingDays: 30,
        iv: 0.2,
        legs: [{ type: 'call', strikePrice: 100, quantity: 1 }],
      }),
    ).toBeNull()
  })
})

describe('Liquidity / AMM research formulas', () => {
  it('log 价格密度映射到价格轴时保持等比例区间质量', () => {
    const density = (price) => logLaplaceDensity(price, { mu: Math.log(100), lambda: 2, kappa: 1 })
    const lowerMass = integrateTrapezoid(density, 80, 100, 512)
    const upperMass = integrateTrapezoid(density, 100, 125, 512)

    expect(lowerMass).toBeCloseTo(upperMass, 3)
  })

  it('流动性指纹按积分离散且权重归一', () => {
    const fp = liquidityFingerprint({
      entryPrice: 100,
      priceGrid: 80,
      segmentCount: 12,
      lowerFactor: 0.8,
      upperFactor: 1.3,
    })
    const total = fp.segments.reduce((sum, seg) => sum + seg.weight, 0)
    expect(total).toBeCloseTo(1, 5)
    expect(fp.segments.every((seg, index, arr) => index === 0 || seg.lower >= arr[index - 1].upper)).toBe(true)
  })

  it('流动性指纹拆出价格、成本、区间和挂单成分', () => {
    const fp = liquidityFingerprint({
      entryPrice: 100,
      activePrice: 97,
      costAnchor: 101,
      targetRange: { lower: 92, upper: 108 },
      orderLevels: [
        { side: 'buy', price: 94, notional: 1000 },
        { side: 'sell', price: 109, notional: 600 },
      ],
      volatility: 0.42,
      priceGrid: 96,
      segmentCount: 16,
      lowerFactor: 0.85,
      upperFactor: 1.18,
    })
    expect(fp.status).toBe('research-only')
    expect(fp.inputMode).toBe('hybrid-model')
    expect(fp.components.map((component) => component.id)).toEqual(['base', 'active', 'cost', 'orders', 'range'])
    expect(fp.stats.orderShare).toBeGreaterThan(0)
    expect(fp.stats.activeShare).toBeGreaterThan(0)
    expect(fp.segments.some((segment) => segment.componentMass.orders > 0)).toBe(true)
    expect(fp.prices.some((point) => point.orderDensity > 0 && point.rangeDensity > 0)).toBe(true)
    expect(fp.segments.reduce((sum, seg) => sum + seg.weight, 0)).toBeCloseTo(1, 5)
    expect(fp.semantics.isProbabilityForecast).toBe(false)
    expect(fp.semantics.interpretation).toBe('target-allocation-weight')
  })

  it('Lambert W principal branch 满足定义', () => {
    const w = lambertW(1)
    expect(w * Math.exp(w)).toBeCloseTo(1, 8)
  })

  it('Numoen 快照有限且保持 protocol-unverified', () => {
    const n = numoenSnapshot()
    expect(n.status).toBe('protocol-unverified')
    expect(Number.isFinite(n.R0)).toBe(true)
    expect(Number.isFinite(n.R1)).toBe(true)
    expect(Number.isFinite(n.slippageY)).toBe(true)
  })
})
