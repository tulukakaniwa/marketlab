import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCsvText } from '../market-data/ohlcv.js'
import { evaluateChartStrategy } from '../strategy-planning/chartStrategyEngine.js'
import {
  MAKER_LADDER_WEIGHTS,
  deriveSqrtPriceLadderRungs,
  resolveMakerLadderEntry,
} from '../strategy-planning/makerLadderExecution.js'
import { evaluatePortfolioRotation, scoreRotationCandidate } from '../strategy-planning/portfolioRotationEngine.js'

describe('2nd-Order LP+Carry+Trend Hybrid, sqrt(P) Maker Ladder & Cross-Asset Rotation', () => {
  it('constructs equal-sqrt(P)-spaced Maker limit rungs and applies Maker fee discount on fill', () => {
    const rungs = deriveSqrtPriceLadderRungs({ signalClose: 100, floorPrice: 94, atr: 0.025 })
    expect(rungs).toHaveLength(MAKER_LADDER_WEIGHTS.length)
    expect(rungs[0].limitPrice).toBeGreaterThan(rungs[1].limitPrice)
    expect(rungs[1].limitPrice).toBeGreaterThan(rungs[2].limitPrice)

    // Verify exact arithmetic spacing in sqrt(P) space
    const s0 = Math.sqrt(rungs[0].limitPrice)
    const s1 = Math.sqrt(rungs[1].limitPrice)
    const s2 = Math.sqrt(rungs[2].limitPrice)
    expect(s0 - s1).toBeCloseTo(s1 - s2, 12)

    const filled = resolveMakerLadderEntry({
      signal: {
        leg: 'structural-repair',
        legLabel: '低吸修复',
        side: 'buy',
        signalClose: 100,
        stopPrice: 92,
        targetPrice: 114,
        ratchetTrigger: 109,
        ratchetLockFraction: 0.38,
        trailMode: 'ratchet-profit',
        horizonSessions: 12,
        atr: 0.025,
      },
      row: { date: '2026-05-02', open: 99.8, high: 101.2, low: 97.5, close: 100.5 },
      index: 42,
      feeRate: 0.001,
    })
    expect(filled).not.toBeNull()
    expect(filled.entryPrice).toBeLessThan(100)
    expect(filled.feeDrag).toBeLessThan(0.001)
  })

  it('satisfies strict prefix causality and positive net return in lp-carry-hybrid mode', () => {
    const ethRows = parseCsvText(readFileSync(resolve('public/data/ETHUSDT-1d.csv'), 'utf8'))
    const prefixRows = ethRows.slice(0, 900)
    const prefixRun = evaluateChartStrategy({
      strategyId: 'lp-carry-hybrid',
      rows: prefixRows,
      tradingDaysPerYear: 365,
      feeRate: 0.001,
    })
    const fullRun = evaluateChartStrategy({
      strategyId: 'lp-carry-hybrid',
      rows: ethRows,
      tradingDaysPerYear: 365,
      feeRate: 0.001,
    })

    expect(prefixRun.active).toBe(true)
    for (let i = 0; i < prefixRows.length; i += 1) {
      expect(fullRun.strategyPath[i].strategyStop).toBe(prefixRun.strategyPath[i].strategyStop)
      expect(fullRun.strategyPath[i].strategyTarget).toBe(prefixRun.strategyPath[i].strategyTarget)
      expect(fullRun.strategyPath[i].strategyEquity).toBeCloseTo(prefixRun.strategyPath[i].strategyEquity, 12)
    }
    expect(fullRun.summary.totalNetReturn).toBeGreaterThan(0)
  })

  it('recycles idle capital across multiple markets causally while respecting maxSlots', () => {
    const universe = [
      ['BTCUSDT', 'public/data/BTCUSDT-1d.csv', 365],
      ['ETHUSDT', 'public/data/ETHUSDT-1d.csv', 365],
      ['NVDA', 'public/data/NVDA-1d.csv', 252],
      ['300750', 'public/data/300750-1d.csv', 242],
    ].map(([symbol, file, tradingDaysPerYear]) => ({
      symbol,
      label: symbol,
      tradingDaysPerYear,
      rows: parseCsvText(readFileSync(resolve(file), 'utf8')).slice(-950),
    }))

    const rot = evaluatePortfolioRotation({
      universe,
      maxSlots: 3,
      feeRate: 0.001,
      useMakerLadder: true,
    })

    expect(rot.status).toBe('ready')
    expect(rot.executionAuthority).toBe('none')
    expect(rot.summary.closedCount).toBeGreaterThan(0)
    expect(rot.summary.totalNetReturn).toBeGreaterThan(0)
    expect(rot.equityCurve.every((pt) => pt.activeSlots <= 3)).toBe(true)
    expect(
      scoreRotationCandidate({ leg: 'vol-breakout', signalClose: 100, displayTarget: 112, horizonSessions: 12 }, 0.001),
    ).toBeGreaterThan(0)
  })
})
