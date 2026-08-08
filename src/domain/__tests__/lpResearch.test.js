import { describe, expect, it } from 'vitest'
import {
  capitalEfficiency,
  capitalEfficiencyAtPrice,
  capitalEfficiencyFrontier,
  capitalEfficiencySecondDerivative,
  ckCapitalEfficiencyReference,
  compareFeeCarryToTheta,
  estimateLpPathFees,
  fundingRate,
  impermanentLoss,
  lpResearchAttribution,
  netCarry,
  netLpEfficiency,
  resolveArithmeticRangeSpec,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
} from '../formulas/core.js'

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

  it('CK ±84.13% 是解析资本效率边际拐点', () => {
    const ref = ckCapitalEfficiencyReference()
    expect(ref.rangeWidth).toBeCloseTo(0.8412994160945599, 14)
    expect(256 * ref.rangeWidth ** 4 - 160 * ref.rangeWidth ** 2 - 15).toBeCloseTo(0, 11)
    expect(ref.efficiency).toBeCloseTo(2.1825988321891194, 13)
    expect(ref.efficiency).toBeCloseTo(0.5 + 2 * ref.rangeWidth, 13)
    expect(ref.geometricMidpointRatio).toBeCloseTo(0.5405694150420948, 13)
    expect(ref.arithmeticCenterEfficiency).toBeCloseTo(2.312999824139203, 13)
    expect(capitalEfficiencyAtPrice({ markPrice: 1, lowerPrice: ref.lower, upperPrice: ref.upper })).toBeCloseTo(
      2.312999824139203,
      13,
    )
    expect(ref.efficiencyValuationBasis).toBe('range-geometric-midpoint')
    expect(ref.claimClass).toBe('exact-identity')
    expect(ref.claimDetail).toBe('geometric-midpoint-capital-efficiency-curve')
    expect(ref.frontierSlope).toBeCloseTo(4.416501970495096, 12)
    expect(Math.abs(ref.secondDerivative)).toBeLessThan(1e-10)
    expect(capitalEfficiencySecondDerivative({ rangeWidth: 0.8, skew: 1 })).toBeGreaterThan(0)
    expect(capitalEfficiencySecondDerivative({ rangeWidth: 0.9, skew: 1 })).toBeLessThan(0)
    expect(ref.isFeeOptimal).toBe(false)
    expect(ref.isPnlOptimal).toBe(false)
    expect(ref.isProbabilityCoverage).toBe(false)
  })

  it('算术范围宽度只接受 0<x<1，缺失值才使用显式默认值', () => {
    expect(resolveArithmeticRangeSpec({ referencePrice: 100, rangeWidth: 1, skew: 1 })).toBeNull()
    expect(resolveArithmeticRangeSpec({ referencePrice: 100, rangeWidth: -0.1, skew: 1 })).toBeNull()
    const fallback = resolveArithmeticRangeSpec({
      referencePrice: 100,
      rangeWidth: null,
      skew: 1,
      defaultRangeWidth: 0.1,
    })
    expect(fallback.rangeWidth).toBe(0.1)
    expect(fallback.lowerPrice).toBeCloseTo(90)
    expect(fallback.upperPrice).toBeCloseTo(110)
  })

  it('偏斜扩展计算自己的拐点，不套用 CK ±84%', () => {
    const frontier = capitalEfficiencyFrontier({ skew: 2 })
    expect(frontier.rangeWidth).not.toBeCloseTo(ckCapitalEfficiencyReference().rangeWidth, 8)
    expect(frontier.theorem).toBe('ck-asymmetric-extension-inflection')
  })

  it('CE 几何不能与 IL 和 fee tier 相加', () => {
    const result = lpResearchAttribution({ capitalEfficiency: 2.18, impermanentLoss: -0.04, horizonDays: 30 })
    expect(result.geometry.capitalEfficiency).toBeCloseTo(2.18)
    expect(result.returns.netReturn).toBeNull()
    expect(result.missingInputs).toContain('realized-or-path-fee-return')
  })

  it('legacy netLpEfficiency 不把 pool fee tier 当成已实现手续费收益', () => {
    const result = netLpEfficiency({ capitalEfficiency: 2.18, impermanentLoss: -0.04, feeRate: 0.003, horizonDays: 30 })
    expect(result.returns.feeReturn).toBeNull()
    expect(result.returns.netReturn).toBeNull()
    expect(result.ignoredInputs).toEqual(['feeRate-without-volume-path'])
  })

  it('fee 与 theta 只有统一口径后才可比较，零成交费不等于零 theta', () => {
    const missingBasis = compareFeeCarryToTheta({ feeIncomeQuote: 0, feeAccrualDays: 1, optionThetaDaily: -2 })
    expect(missingBasis.comparable).toBe(false)
    const compared = compareFeeCarryToTheta({
      feeIncomeQuote: 0,
      feeAccrualDays: 1,
      optionThetaDaily: -2,
      feeCurrency: 'USD',
      optionCurrency: 'USD',
      feeNotional: 1000,
      optionNotional: 1000,
    })
    expect(compared.comparable).toBe(true)
    expect(compared.feeCarryPerDay).toBe(0)
    expect(compared.thetaDaily).toBe(-2)
    expect(compared.relation).toBe('analogy-not-identity')
  })

  it('路径手续费随成交量变化；同价格路径不等于同 fee', () => {
    const base = { feeTier: 0.003, positionLiquidity: 10, activeLiquidity: 100, inRangeFraction: 1 }
    const quiet = estimateLpPathFees({
      steps: [{ ...base, volumeQuote: 0 }],
      initialCapitalQuote: 1000,
      currency: 'USD',
    })
    const active = estimateLpPathFees({
      steps: [{ ...base, volumeQuote: 10000 }],
      initialCapitalQuote: 1000,
      currency: 'USD',
    })
    expect(quiet.feeIncomeQuote).toBe(0)
    expect(active.feeIncomeQuote).toBeCloseTo(3)
    expect(active.feeReturn).toBeGreaterThan(quiet.feeReturn)
    expect(active.pathDependent).toBe(true)
  })

  it('只有 fee tier 或非法 in-range 比例时不生成手续费收入', () => {
    const tierOnly = estimateLpPathFees({ steps: [{ feeTier: 0.003 }], initialCapitalQuote: 1000 })
    const invalidRange = estimateLpPathFees({
      steps: [{ feeTier: 0.003, volumeQuote: 1000, positionLiquidity: 10, activeLiquidity: 100, inRangeFraction: 1.2 }],
      initialCapitalQuote: 1000,
    })
    expect(tierOnly.feeIncomeQuote).toBeNull()
    expect(invalidRange.feeIncomeQuote).toBeNull()
    expect(invalidRange.missingInputs).toContain('steps[0].inRangeFraction')
  })

  it('fundingRate 永续溢价时为正', () => {
    const f = fundingRate({ perpTwap: 101, spotTwap: 100, hours: 8 })
    expect(f.funding).toBeGreaterThan(0)
    expect(f.status).toBe('proxy-only')
    expect(f.cumulativeFundingEstimate).toBeCloseTo((f.basisEstimate * 8) / 24, 10)
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
