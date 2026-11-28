import { describe, expect, it } from 'vitest'
import {
  bachelierCarryOption,
  buildOptionPortfolio,
  capitalEfficiencyFrontier,
  capitalEfficiencySecondDerivative,
  ckCapitalEfficiencyReference,
  deriveDynamicHoldingState,
  deriveRecoveryHorizon,
  deriveRunupFeatures,
  deriveStateRecurrence,
  estimateDynamicCkSkew,
  getDeltaBandCurvature,
  getDeltaBandSlope,
  getDeltaBandValue,
  getDeltaBands,
  invertDeltaBand,
} from '../formulas/core.js'
import { buildDynamicHoldingGate } from '../strategy-planning/dynamicHoldingGate.js'
import { evaluateOrderLadderDiagnostics } from '../strategy-planning/orderLadderDiagnostics.js'
import { solveFirstPassage } from '../market-model/firstPassage.js'

const SAMPLE_CAUSAL_STATE = {
  status: 'ready',
  markPrice: 100,
  equilibrium: { logPrice: Math.log(104) },
  dynamics: {
    components: [
      { id: 'calm', weight: 0.7, driftPerSession: 0.001, reversionRate: 0.08, variancePerSession: 0.0009 },
      { id: 'stressed', weight: 0.3, driftPerSession: -0.002, reversionRate: 0.04, variancePerSession: 0.0025 },
    ],
    transitionMatrix: [
      [0.92, 0.08],
      [0.15, 0.85],
    ],
  },
}

describe('Formal Mathematical Theorems & Extended Domain Operators', () => {
  it('Theorem 1: AR(1) endogenous recovery horizon exact dyadic identities & fill-price monotonicity', () => {
    const hl = 12.5
    const hHalf = deriveRecoveryHorizon({
      cycleStartPrice: 80,
      targetPrice: 90,
      anchorPrice: 100,
      halfLifeSessions: hl,
      side: 'long',
    })
    const hThreeQuarters = deriveRecoveryHorizon({
      cycleStartPrice: 80,
      targetPrice: 95,
      anchorPrice: 100,
      halfLifeSessions: hl,
      side: 'long',
    })
    const hSevenEighths = deriveRecoveryHorizon({
      cycleStartPrice: 80,
      targetPrice: 97.5,
      anchorPrice: 100,
      halfLifeSessions: hl,
      side: 'long',
    })

    expect(hHalf.modelHorizonRaw).toBeCloseTo(hl, 12)
    expect(hThreeQuarters.modelHorizonRaw).toBeCloseTo(2 * hl, 12)
    expect(hSevenEighths.modelHorizonRaw).toBeCloseTo(3 * hl, 12)
    expect(hHalf.modelHorizonSessions).toBe(Math.ceil(hl))
    expect(hThreeQuarters.modelHorizonSessions).toBe(Math.ceil(2 * hl))
    expect(hSevenEighths.modelHorizonSessions).toBe(Math.ceil(3 * hl))

    // Deeper fill price strictly increases recovery fraction q and re-bound horizon
    const deeperFill = deriveRecoveryHorizon({
      cycleStartPrice: 75,
      targetPrice: 90,
      anchorPrice: 100,
      halfLifeSessions: hl,
      side: 'long',
    })
    expect(deeperFill.recoveryFraction).toBeGreaterThan(hHalf.recoveryFraction)
    expect(deeperFill.modelHorizonRaw).toBeGreaterThan(hHalf.modelHorizonRaw)
  })

  it('Theorem 2: GetDelta (1-d) short dual symmetry, central-difference negative convexity, and exact inverse bijection', () => {
    const cases = [
      { entryPrice: 100, formulaHorizonSessions: 18, iv: 0.35, deltaSlope: 0.25, z: 1, tradingDaysPerYear: 252 },
      { entryPrice: 2450, formulaHorizonSessions: 42, iv: 0.58, deltaSlope: 0.68, z: 1.15, tradingDaysPerYear: 365 },
      { entryPrice: 36.8, formulaHorizonSessions: 9, iv: 0.22, deltaSlope: 0.05, z: 1, tradingDaysPerYear: 242 },
    ]

    for (const params of cases) {
      const bands = getDeltaBands(params)
      expect(bands).not.toBeNull()

      // Unconditional interiority P0 in [K/r, K*r] on both long and short bands
      expect(params.entryPrice).toBeGreaterThanOrEqual(bands.long.low - 1e-12)
      expect(params.entryPrice).toBeLessThanOrEqual(bands.long.high + 1e-12)
      expect(params.entryPrice).toBeGreaterThanOrEqual(bands.short.low - 1e-12)
      expect(params.entryPrice).toBeLessThanOrEqual(bands.short.high + 1e-12)

      // Exact short (1 - d) dual identity: short.cost === long.cost(1 - d) and short net slope === -d
      const mirrorBands = getDeltaBands({ ...params, deltaSlope: 1 - params.deltaSlope })
      expect(bands.short.cost).toBeCloseTo(mirrorBands.long.cost, 10)
      expect(bands.short.remainingLongSlopeAtEntry).toBeCloseTo(1 - params.deltaSlope, 12)
      expect(bands.short.localSlopeAtEntry).toBeCloseTo(-params.deltaSlope, 12)
      expect(
        getDeltaBandSlope({ price: params.entryPrice, cost: bands.short.cost, ratio: bands.longRatio }) - 1,
      ).toBeCloseTo(-params.deltaSlope, 11)

      // Negative convexity V''(P) matches central difference of V(P) and V'(P)
      const h = params.entryPrice * 1e-4
      const hSlope = params.entryPrice * 1e-6
      const vMinus = getDeltaBandValue({ price: params.entryPrice - h, cost: bands.long.cost, ratio: bands.longRatio })
      const vCenter = getDeltaBandValue({ price: params.entryPrice, cost: bands.long.cost, ratio: bands.longRatio })
      const vPlus = getDeltaBandValue({ price: params.entryPrice + h, cost: bands.long.cost, ratio: bands.longRatio })
      const sMinus = getDeltaBandSlope({
        price: params.entryPrice - hSlope,
        cost: bands.long.cost,
        ratio: bands.longRatio,
      })
      const sPlus = getDeltaBandSlope({
        price: params.entryPrice + hSlope,
        cost: bands.long.cost,
        ratio: bands.longRatio,
      })
      const fdCurvature = (vPlus - 2 * vCenter + vMinus) / (h * h)
      const exactCurvature = getDeltaBandCurvature({
        price: params.entryPrice,
        cost: bands.long.cost,
        ratio: bands.longRatio,
      })
      expect(exactCurvature).toBeLessThan(0)
      expect(bands.long.curvatureAtEntry).toBeCloseTo(exactCurvature, 14)
      expect(exactCurvature).toBeCloseTo(fdCurvature, 7)
      expect(exactCurvature).toBeCloseTo((sPlus - sMinus) / (2 * hSlope), 10)

      // Exact inverse bijection F^-1(F(sigma, d)) === (sigma, d)
      const inverted = invertDeltaBand({
        lowerPrice: bands.long.low,
        upperPrice: bands.long.high,
        entryPrice: params.entryPrice,
        formulaHorizonSessions: params.formulaHorizonSessions,
        z: params.z,
        tradingDaysPerYear: params.tradingDaysPerYear,
        realizedVol: params.iv * 0.9,
      })
      expect(inverted.impliedVol).toBeCloseTo(params.iv, 12)
      expect(inverted.impliedDeltaSlope).toBeCloseTo(params.deltaSlope, 12)
      expect(inverted.impliedAnchor).toBeCloseTo(bands.long.cost, 10)
    }
  })

  it('Theorem 3: CK palindromic radical closed form x* = sqrt(5 + 2*sqrt(10)) / 4 and alpha >= 0 quintic root', () => {
    const radicalWidth = Math.sqrt(5 + 2 * Math.sqrt(10)) / 4
    const radicalU = (4 + Math.sqrt(10) - Math.sqrt(8 * Math.sqrt(10) - 10)) / 6
    const ref = ckCapitalEfficiencyReference()

    expect(ref.rangeWidth).toBeCloseTo(radicalWidth, 14)
    expect(Math.pow(ref.rangeRatio, 0.25)).toBeCloseTo(radicalU, 14)
    expect(Math.abs(capitalEfficiencySecondDerivative({ rangeWidth: radicalWidth, skew: 1 }))).toBeLessThan(1e-11)

    // Exact alpha = 0 limit: u*(0) = 3/5 => x*(0) = 1 - (3/5)^4 = 544/625 = 0.8704, CE*(0) = 2.5
    const zeroSkew = capitalEfficiencyFrontier({ skew: 0 })
    expect(Math.pow(zeroSkew.rangeRatio, 0.25)).toBeCloseTo(0.6, 11)
    expect(zeroSkew.rangeWidth).toBeCloseTo(544 / 625, 11)
    expect(zeroSkew.efficiency).toBeCloseTo(2.5, 11)

    // Prefix-causal dynamic CK skew bridges sample directional ratio into CK Part 2
    const rows = Array.from({ length: 40 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      close: 100 * Math.exp((i % 3 === 0 ? -0.014 : 0.011) * ((i % 5) + 1) * 0.2),
    }))
    const skew = estimateDynamicCkSkew({ rows, referencePrice: 100, halfLifeSessions: 10 })
    const fullWithFuture = estimateDynamicCkSkew({
      rows: [...rows, { date: '2026-03-01', close: 250 }, { date: '2026-03-02', close: 40 }],
      index: rows.length - 1,
      referencePrice: 100,
      halfLifeSessions: 10,
    })
    expect(skew.status).toBe('ok')
    expect(skew.directionalMoveScaleRatio).toBeCloseTo(fullWithFuture.directionalMoveScaleRatio, 14)
    expect(
      Math.abs(capitalEfficiencySecondDerivative({ rangeWidth: skew.ckRangeWidth, skew: skew.ckSkewAlphaScenario })),
    ).toBeLessThan(1e-10)
  })

  it('Theorem 4: Spot-carry risk-neutral Bachelier analytical Greeks match finite differences & Put-Call Parity', () => {
    const base = {
      entryPrice: 102,
      strikePrice: 100,
      timeToExpirySessions: 45,
      normalVol: 32,
      riskFreeRate: 0.045,
      dividendYield: 0.015,
      tradingDaysPerYear: 252,
    }
    const call = bachelierCarryOption({ ...base, type: 'call' })
    const put = bachelierCarryOption({ ...base, type: 'put' })
    const T = base.timeToExpirySessions / base.tradingDaysPerYear

    // Put-Call Parity identities
    const parityForward =
      base.entryPrice * Math.exp(-base.dividendYield * T) - base.strikePrice * Math.exp(-base.riskFreeRate * T)
    expect(call.price - put.price).toBeCloseTo(parityForward, 11)
    expect(call.optionDelta - put.optionDelta).toBeCloseTo(Math.exp(-base.dividendYield * T), 12)
    expect(call.optionGamma).toBeCloseTo(put.optionGamma, 12)
    expect(call.optionThetaAnnual - put.optionThetaAnnual).toBeCloseTo(
      base.dividendYield * base.entryPrice * Math.exp(-base.dividendYield * T) -
        base.riskFreeRate * base.strikePrice * Math.exp(-base.riskFreeRate * T),
      10,
    )
    expect(call.optionRhoPerPct - put.optionRhoPerPct).toBeCloseTo(
      (T * base.strikePrice * Math.exp(-base.riskFreeRate * T)) / 100,
      11,
    )

    // Central finite-difference verification of Put Greeks (bounded by A&S 7.1.26 normalCdf 1.5e-7 precision)
    const dS = 1e-2
    const pUpS = bachelierCarryOption({ ...base, entryPrice: base.entryPrice + dS, type: 'put' }).price
    const pDnS = bachelierCarryOption({ ...base, entryPrice: base.entryPrice - dS, type: 'put' }).price
    expect(put.optionDelta).toBeCloseTo((pUpS - pDnS) / (2 * dS), 5)
    expect(put.optionGamma).toBeCloseTo((pUpS - 2 * put.price + pDnS) / (dS * dS), 4)

    const dH = 1e-2
    const pNextSession = bachelierCarryOption({
      ...base,
      timeToExpirySessions: base.timeToExpirySessions - dH,
      type: 'put',
    }).price
    const pPrevSession = bachelierCarryOption({
      ...base,
      timeToExpirySessions: base.timeToExpirySessions + dH,
      type: 'put',
    }).price
    expect(put.optionThetaPerSession).toBeCloseTo((pNextSession - pPrevSession) / (2 * dH), 5)

    const dR = 1e-4
    const pUpR = bachelierCarryOption({ ...base, riskFreeRate: base.riskFreeRate + dR, type: 'put' }).price
    const pDnR = bachelierCarryOption({ ...base, riskFreeRate: base.riskFreeRate - dR, type: 'put' }).price
    expect(put.optionRhoPerPct).toBeCloseTo(((pUpR - pDnR) / (2 * dR)) * 0.01, 5)

    // Portfolio aggregation propagates non-null Theta & Rho for bachelier-carry legs
    const portfolio = buildOptionPortfolio({
      entryPrice: base.entryPrice,
      timeToExpirySessions: base.timeToExpirySessions,
      iv: 0.3,
      riskFreeRate: base.riskFreeRate,
      dividendYield: base.dividendYield,
      tradingDaysPerYear: base.tradingDaysPerYear,
      legs: [
        {
          type: 'put',
          side: 'long',
          strikePrice: base.strikePrice,
          quantity: 2,
          model: 'bachelier-carry',
          normalVol: base.normalVol,
        },
      ],
    })
    expect(portfolio.optionThetaPerSession).toBeCloseTo(2 * put.optionThetaPerSession, 10)
    expect(portfolio.optionRhoPerPct).toBeCloseTo(2 * put.optionRhoPerPct, 10)
  })

  it('Theorem 5 & Short Symmetry: Absorbing mass conservation, KM Greenwood bounds, and short-side dynamic holding gate', () => {
    const fp = solveFirstPassage({ state: SAMPLE_CAUSAL_STATE, lowerPrice: 92, upperPrice: 110, horizonSessions: 32 })
    expect(fp.status).toBe('ready')
    for (const step of fp.distribution) {
      expect(step.lowerCumulative + step.upperCumulative + step.survival).toBeCloseTo(1, 12)
    }

    // State recurrence prefix invariance & log-log Greenwood bounds strictly inside [0, 1]
    const series = Array.from({ length: 90 }, (_, i) => 0.06 * Math.sin(i * 0.42) + 0.02 * Math.cos(i * 0.17))
    const rec = deriveStateRecurrence({ costDistanceSeries: series })
    const recExtended = deriveStateRecurrence({ costDistanceSeries: [...series, 0.25, -0.3], index: series.length - 1 })
    expect(rec.status).toBe('ok')
    expect(rec.recurrencePeriodSessions).toBeCloseTo(recExtended.recurrencePeriodSessions, 14)
    for (const pt of rec.kaplanMeier.points) {
      expect(pt.confidenceLower95).toBeGreaterThanOrEqual(0)
      expect(pt.confidenceUpper95).toBeLessThanOrEqual(1)
      expect(pt.confidenceLower95).toBeLessThanOrEqual(pt.survivalProbability + 1e-12)
      expect(pt.confidenceUpper95).toBeGreaterThanOrEqual(pt.survivalProbability - 1e-12)
    }

    // Short-side dynamic holding gate symmetry (runup peak -> pullback repair >= 15% -> '观察')
    const shortCloses = [100, 102, 105, 109, 114, 118, 122, 125, 124, 121, 119]
    const shortRows = shortCloses.map((close, idx) => ({
      date: `2026-02-${String(idx + 1).padStart(2, '0')}`,
      open: close,
      high: close * 1.005,
      low: close * 0.995,
      close,
      volume: 1000,
    }))
    const runup = deriveRunupFeatures({ rows: shortRows })
    expect(runup.status).toBe('ok')
    expect(runup.pullbackRepair).toBeGreaterThan(0.15)

    const shortState = deriveDynamicHoldingState({
      zScore: 2.1,
      halfLifeSessions: 8,
      entryPrice: 119,
      anchorPrice: 104,
      targetPrices: { costUpper: 111, anchor: 104 },
      drawdown: runup,
      costSlopePct: 0.4,
      side: 'short',
    })
    expect(shortState.phase).toBe('repair-start')
    expect(shortState.status).toBe('观察')

    const gate = buildDynamicHoldingGate({
      market: {
        markPrice: 119,
        costAnchor: 104,
        costLow: 98,
        costHigh: 111,
        costDistance: (119 - 104) / 104,
        annualVol: 0.35,
        costSlopeRecent: 0.004,
      },
      rows: shortRows,
      formulaPoint: {
        formulaHorizonSessions: 9,
        fieldStates: {
          formulaHorizonSessions: {
            status: 'research-only',
            context: { side: 'short', halfLifeSessions: 8, cycleStartPrice: 119, mode: 'formula-derived' },
          },
        },
      },
      tradingDaysPerYear: 252,
    })
    expect(gate.side).toBe('short')
    expect(gate.status).toBe('观察')
  })

  it('Theorem 6: sqrt(P)-geometric order ladder AM-GM bound and conditional first-passage decomposition', () => {
    const orders = [
      {
        role: '模拟买入 1',
        side: 'buy',
        price: 100,
        targetPrice: 108,
        stopPrice: 88,
        notional: 2000,
        amount: 20,
        formulaHorizonSessions: 20,
      },
      {
        role: '模拟买入 2',
        side: 'buy',
        price: 95,
        targetPrice: 108,
        stopPrice: 88,
        notional: 3000,
        amount: 3000 / 95,
        formulaHorizonSessions: 20,
      },
      {
        role: '模拟买入 3',
        side: 'buy',
        price: 90,
        targetPrice: 108,
        stopPrice: 88,
        notional: 5000,
        amount: 5000 / 90,
        formulaHorizonSessions: 20,
      },
    ]
    const diag = evaluateOrderLadderDiagnostics({
      orders,
      side: 'buy',
      markPrice: 100,
      addToPrice: 90,
      stopPrice: 88,
      targetPrice: 108,
      horizonSessions: 20,
      causalState: SAMPLE_CAUSAL_STATE,
    })

    expect(diag.status).toBe('ready')
    expect(diag.executionAuthority).toBe('none')
    // Rung 0 & 2 match endpoints; middle rung satisfies exact AM-GM: sqrt(100 * 90) < 95
    expect(diag.orders[0].geometricPrice).toBeCloseTo(100, 12)
    expect(diag.orders[1].geometricPrice).toBeCloseTo(Math.sqrt(9000), 12)
    expect(diag.orders[1].geometricPrice).toBeLessThan(diag.orders[1].arithmeticPrice)
    expect(diag.orders[2].geometricPrice).toBeCloseTo(90, 12)

    // Rung 0 at mark fills with probability 1; deeper rungs monotonically decrease fill probability and conserve probability mass
    expect(diag.orders[0].fillBeforeTargetProb).toBe(1)
    expect(diag.orders[1].fillBeforeTargetProb).toBeGreaterThan(diag.orders[2].fillBeforeTargetProb)
    for (const rung of diag.orders) {
      expect(rung.fillBeforeTargetProb + rung.targetBeforeFillProb + rung.neitherProb).toBeCloseTo(1, 12)
    }
    expect(diag.expectedFilledNotional).toBeGreaterThan(2000)
    expect(diag.expectedFilledNotional).toBeLessThan(10000)
  })
})
