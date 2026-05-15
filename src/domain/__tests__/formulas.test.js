import { describe, expect, it } from 'vitest'
import {
  blackScholes,
  capitalEfficiency,
  fundingRate,
  getDeltaBands,
  impermanentLoss,
  normalCdf,
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
  it('看跌的 delta 在 [-1, 0]', () => {
    const o = blackScholes({ entryPrice: 100, strikePrice: 100, holdingDays: 30, iv: 0.4, riskFreeRate: 0.04, type: 'put' })
    expect(o.delta).toBeLessThanOrEqual(0)
    expect(o.delta).toBeGreaterThanOrEqual(-1)
    expect(o.gamma).toBeGreaterThan(0)
  })
  it('看涨的 delta 在 [0, 1]', () => {
    const o = blackScholes({ entryPrice: 100, strikePrice: 100, holdingDays: 30, iv: 0.4, riskFreeRate: 0.04, type: 'call' })
    expect(o.delta).toBeGreaterThanOrEqual(0)
    expect(o.delta).toBeLessThanOrEqual(1)
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
  })
})
