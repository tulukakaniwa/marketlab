import { describe, expect, it } from 'vitest'
import {
  asianOption,
  bachelierOption,
  blackScholes,
  buildOptionPortfolio,
  capitalEfficiency,
  fundingRate,
  getDeltaBands,
  impermanentLoss,
  integrateTrapezoid,
  lambertW,
  liquidityFingerprint,
  logLaplaceDensity,
  netCarry,
  numoenSnapshot,
  normalCdf,
  optionLegsFromTemplate,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
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
    const o = blackScholes({ entryPrice: 100, strikePrice: 100, holdingDays: 365, iv: 0.2, riskFreeRate: 0.05, type: 'call' })
    expect(o.price).toBeCloseTo(10.4506, 2)
    expect(o.delta).toBeCloseTo(0.6368, 2)
    expect(Number.isFinite(o.rho)).toBe(true)
    expect(Number.isFinite(o.thetaDaily)).toBe(true)
    expect(Number.isFinite(o.thetaAnnual)).toBe(true)
  })
  it('看跌的 delta 在 [-1, 0]', () => {
    const o = blackScholes({ entryPrice: 100, strikePrice: 100, holdingDays: 30, iv: 0.4, riskFreeRate: 0.04, type: 'put' })
    expect(o.delta).toBeLessThanOrEqual(0)
    expect(o.delta).toBeGreaterThanOrEqual(-1)
    expect(o.gamma).toBeGreaterThan(0)
    expect(o.rho).toBeLessThanOrEqual(0)
  })
  it('看涨的 delta 在 [0, 1]', () => {
    const o = blackScholes({ entryPrice: 100, strikePrice: 100, holdingDays: 30, iv: 0.4, riskFreeRate: 0.04, type: 'call' })
    expect(o.delta).toBeGreaterThanOrEqual(0)
    expect(o.delta).toBeLessThanOrEqual(1)
    expect(o.rho).toBeGreaterThanOrEqual(0)
  })
})

describe('Asian / Bachelier research formulas', () => {
  it('输出有限研究值并拒绝非法参数', () => {
    const asian = asianOption({ entryPrice: 100, strikePrice: 105, holdingDays: 30, iv: 0.4, riskFreeRate: 0.02, type: 'put' })
    const bach = bachelierOption({ entryPrice: 100, strikePrice: 105, holdingDays: 30, normalVol: 40, riskFreeRate: 0.02, type: 'put' })
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

  it('非法或空 legs 返回 null', () => {
    expect(buildOptionPortfolio({ entryPrice: 100, holdingDays: 30, iv: 0.2, legs: [] })).toBeNull()
    expect(buildOptionPortfolio({ entryPrice: 0, holdingDays: 30, iv: 0.2, legs: [{ type: 'call', strikePrice: 100, quantity: 1 }] })).toBeNull()
  })
})

describe('LP / IL / CE / Funding', () => {
  it('uniswapV3Inventory 区间内 token0/token1 都为正', () => {
    const lp = uniswapV3Inventory({ markPrice: 100, lowerPrice: 80, upperPrice: 120, liquidity: 10 })
    expect(lp.token0).toBeGreaterThan(0)
    expect(lp.token1).toBeGreaterThan(0)
    expect(Number.isFinite(lp.value)).toBe(true)
  })
  it('impermanentLoss 同价无损', () => {
    const il = impermanentLoss({ markPrice: 100, startPrice: 100, liquidity: 10 })
    expect(Math.abs(il.impermanentLoss)).toBeLessThan(1e-9)
  })
  it('capitalEfficiency 区间越窄效率越高', () => {
    const wide = capitalEfficiency({ rangeWidth: 0.5, skew: 1 })
    const narrow = capitalEfficiency({ rangeWidth: 0.05, skew: 1 })
    expect(narrow.efficiency).toBeGreaterThan(wide.efficiency)
  })
  it('fundingRate 永续溢价时为正', () => {
    const f = fundingRate({ perpTwap: 101, spotTwap: 100, hours: 8 })
    expect(f.funding).toBeGreaterThan(0)
    expect(f.status).toBe('proxy-only')
    expect(f.cumulativeFundingEstimate).toBeCloseTo(f.basisEstimate * 8 / 24, 10)
  })
  it('netCarry 直接消费累计 funding proxy，不重复乘时间', () => {
    const c = netCarry({ costDistance: 0.1, fundingRate: 0.02, holdingDays: 30, tradingDaysPerYear: 365 })
    expect(c.fundingCost).toBeCloseTo(0.02, 10)
    expect(c.netReturn).toBeCloseTo(0.08, 10)
    expect(c.status).toBe('proxy-only')
  })
  it('uniswapV3HedgedPosition 使用非对称真实 v3 区间', () => {
    const lp = uniswapV3HedgedPosition({
      markPrice: 110,
      startPrice: 100,
      lowerPrice: 70,
      upperPrice: 130,
      liquidity: 10,
      hedgeSize: 0.2,
      fees: 1,
    })
    expect(lp.status).toBe('research-only')
    expect(lp.zone).toBe('range')
    expect(lp.lowerPrice).toBe(70)
    expect(lp.upperPrice).toBe(130)
    expect(Number.isFinite(lp.combinedValue)).toBe(true)
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
    const fp = liquidityFingerprint({ entryPrice: 100, priceGrid: 80, segmentCount: 12, lowerFactor: 0.8, upperFactor: 1.3 })
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
