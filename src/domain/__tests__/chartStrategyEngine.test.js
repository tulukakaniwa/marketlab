import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBinanceKlines, parseCsvText } from '../market-data/ohlcv.js'
import { queryMarketLabChartSeries } from '../research-visualization/marketLabChartIndicators.js'
import { evaluateChartStrategy, normalizeChartStrategyId } from '../strategy-planning/chartStrategyEngine.js'

describe('Chart Profitable Strategy Engine', () => {
  it('returns inactive clean model when strategyId is off or unknown', () => {
    expect(normalizeChartStrategyId('unknown')).toBe('off')
    const off = evaluateChartStrategy({ strategyId: 'off', rows: [], tradingDaysPerYear: 365 })
    expect(off.active).toBe(false)
    expect(off.executionAuthority).toBe('none')
    expect(off.trades).toHaveLength(0)
  })

  it('satisfies strict prefix causality: appending future bars never mutates historical trades or rails', () => {
    const csv = readFileSync(resolve('public/data/NVDA-1d.csv'), 'utf8')
    const fullRows = parseCsvText(csv).slice(-260)
    const prefixLen = 190
    const prefixRows = fullRows.slice(0, prefixLen)

    const prefixRun = evaluateChartStrategy({
      strategyId: 'regime-combo',
      rows: prefixRows,
      tradingDaysPerYear: 252,
      feeRate: 0.001,
    })
    const fullRun = evaluateChartStrategy({
      strategyId: 'regime-combo',
      rows: fullRows,
      tradingDaysPerYear: 252,
      feeRate: 0.001,
    })

    expect(prefixRun.active).toBe(true)
    for (let i = 0; i < prefixLen; i += 1) {
      expect(fullRun.strategyPath[i].strategyStop).toBe(prefixRun.strategyPath[i].strategyStop)
      expect(fullRun.strategyPath[i].strategyTarget).toBe(prefixRun.strategyPath[i].strategyTarget)
      expect(fullRun.strategyPath[i].strategyEquity).toBeCloseTo(prefixRun.strategyPath[i].strategyEquity, 12)
    }

    const cutoffDate = prefixRows.at(-1).date
    const fullPrefixClosed = fullRun.trades.filter((t) => t.exitDate <= cutoffDate)
    expect(fullPrefixClosed).toEqual(prefixRun.trades)
  })

  it('captures profitable trades and emits chart stop/target series & markers on real BTC and stock data', () => {
    const btcCsv = readFileSync(resolve('public/data/btcusdt-1d-2017-2025.csv'), 'utf8')
    const btcRows = parseBinanceKlines(btcCsv).slice(-520)

    const combo = evaluateChartStrategy({
      strategyId: 'regime-combo',
      rows: btcRows,
      tradingDaysPerYear: 365,
      feeRate: 0.001,
    })

    expect(combo.active).toBe(true)
    expect(combo.summary.closedCount).toBeGreaterThan(0)
    expect(combo.summary.totalNetReturn).toBeGreaterThan(0)
    expect(combo.markers.length).toBeGreaterThan(0)

    const chartModel = queryMarketLabChartSeries({
      rows: btcRows,
      formulaPath: btcRows.map((r) => ({ date: r.date })),
      strategyPath: combo.strategyPath,
      overlays: { priceBands: true },
    })
    const priceSeries = chartModel.groups.find((g) => g.id === 'price').series
    expect(priceSeries.some((s) => s.id === 'strategyStop' && s.points.length > 0)).toBe(true)
    expect(priceSeries.some((s) => s.id === 'strategyTarget' && s.points.length > 0)).toBe(true)
  })
})
