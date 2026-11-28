import { describe, expect, it } from 'vitest'
import { deriveStructuralHoldWindow, uniswapV3HedgedInventory, uniswapV3HedgedPosition } from '../formulas/core.js'
import { closeAccountPosition } from '../replay/dailyReplayExecution.js'
import {
  buildEntryTiming,
  buildPositionPlan,
  resolveProfile,
  scaleProfileToMarket,
} from '../strategy-planning/orderPlan.js'

describe('Calculation bug regressions', () => {
  it('scales replay profile so buyCooldown/sellCooldown and cutMomentum are finite positive numbers, never undefined/NaN', () => {
    const raw = resolveProfile('balanced')
    expect(raw.buyCooldown).toBeUndefined()
    const scaled = scaleProfileToMarket(raw, {
      atrPercent: 0.025,
      annualVol: 0.4,
      tradingDaysPerYear: 252,
      windowSpec: { recent: 5, mode: 'adaptive-prefix' },
    })
    expect(Number.isInteger(scaled.buyCooldown) && scaled.buyCooldown > 0).toBe(true)
    expect(Number.isInteger(scaled.sellCooldown) && scaled.sellCooldown > 0).toBe(true)
    expect(scaled.cutMomentumAtr).toBeGreaterThan(0)
    expect(scaled.cutMomentumMin).toBeGreaterThan(0)
  })

  it('never generates a buy stop above markPrice or masks inverted stops via Math.abs', () => {
    const market = {
      markPrice: 95,
      costAnchor: 105,
      costLow: 98,
      costHigh: 112,
      costDistance: -10 / 105,
      atrPercent: 0.02,
      annualVol: 0.35,
      momentumFast: 0.02,
      costSlopeRecent: 0.001,
      tradingDaysPerYear: 252,
      windowSpec: { recent: 5, mode: 'adaptive-prefix' },
    }
    const bands = { long: { low: 95, cost: 100, high: 105 }, short: { low: 95, cost: 100, high: 105 } }
    const timing = buildEntryTiming(market, bands, undefined, {
      formulaHorizonSessions: 10,
      formulaHorizonSide: 'long',
      horizonAnchorPrice: 105,
      horizonTargetPrice: 98,
      horizonHalfLifeSessions: 8,
      iv: 0.35,
      tradingDaysPerYear: 252,
    })
    expect(timing.side).toBe('buy')
    expect(timing.stop).toBeLessThan(market.markPrice)

    // Explicitly inverted stop must be rejected by buildPositionPlan instead of masked by Math.abs
    const inverted = buildPositionPlan(
      { ...timing, stop: 99 },
      bands,
      { isConfigured: true, cash: 10000, base: 0, equity: 10000 },
      undefined,
      market,
      {
        formulaHorizonSessions: 10,
        formulaHorizonSide: 'long',
        horizonAnchorPrice: 105,
        horizonTargetPrice: 98,
        horizonHalfLifeSessions: 8,
      },
    )
    expect(inverted.executionStatus).toBe('blocked')
    expect(inverted.maxNotional).toBeNull()
  })

  it('computes net returnRate consistent with fee-deducted pnl in closeAccountPosition', () => {
    const closed = closeAccountPosition({
      row: { date: '2026-06-01' },
      index: 10,
      cash: 0,
      fee: 0.002,
      plan: {
        lotId: 'lot-1',
        baseAmount: 0.998,
        investedCost: 100,
        targetPrice: 110,
        stopPrice: 90,
      },
      exit: {
        price: 100.3,
        reason: '到期',
        intrabarBothHit: false,
        intrabarPolicy: 'stop-first',
        exitPriceSource: 'close-expiry',
      },
    })
    expect(closed.event.pnl).toBeLessThan(0)
    expect(closed.event.returnRate).toBeLessThan(0)
    expect(closed.event.returnRate).toBeCloseTo(closed.event.pnl / 100, 12)
  })

  it('aligns hedgePnl sign in uniswapV3HedgedInventory with uniswapV3HedgedPosition so value = lpPnl + hedgePnl + feeIncome', () => {
    const sym = uniswapV3HedgedInventory({
      markPrice: 110,
      strikePrice: 100,
      rangeFactor: 1.2,
      liquidity: 10,
      hedgeSize: 0.5,
      feeIncomeQuote: 2,
    })
    const pos = uniswapV3HedgedPosition({
      markPrice: 110,
      startPrice: 100,
      lowerPrice: 100 / 1.2,
      upperPrice: 120,
      liquidity: 10,
      hedgeSize: 0.5,
      feeIncomeQuote: 2,
    })
    expect(sym.hedgePnl).toBe(-5)
    expect(pos.hedgePnl).toBe(-5)
    expect(sym.lpPnl + sym.hedgePnl + sym.feeIncome).toBeCloseTo(sym.value, 12)
  })

  it('computes short-side structural grossReturn relative to entryPrice, not targetPrice', () => {
    const res = deriveStructuralHoldWindow({
      zScore: 2.2,
      halfLifeSessions: 8,
      entryPrice: 100,
      anchorPrice: 60,
      targetPrices: { costUpper: 80 },
      side: 'short',
      minimumGrossReturn: 0.1,
    })
    expect(res.eligible).toBe(true)
    // Short from 100 to 80 is +20% ((100 - 80) / 100 = 0.20), NOT 100/80 - 1 = +25%
    expect(res.selected.grossReturn).toBeCloseTo(0.2, 12)
  })
})
