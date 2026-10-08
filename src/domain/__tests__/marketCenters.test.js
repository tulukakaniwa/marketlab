import { describe, expect, it } from 'vitest'
import { buildMarketCentersSnapshot, defaultMarketCenterConfig } from '../market-model/marketCenters.js'

const date = (i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10)
const rows = Array.from({ length: 160 }, (_, i) => ({
  date: date(i),
  close: 100 + Math.sin(i) * 3,
  high: 105,
  low: 95,
  volume: 100,
}))
const provenance = (i) => ({ kind: 'scenario', asOfDate: date(i), availableAt: `${date(i)}:close` })

describe('independent market center aggregation', () => {
  it('selects the observation prefix before touching future prices or parameters', () => {
    const future = new Proxy(
      {},
      {
        get() {
          throw new Error('future read')
        },
      },
    )
    const result = buildMarketCentersSnapshot({ rows: [...rows.slice(0, 80), future], observationIndex: 79 })
    const prefix = buildMarketCentersSnapshot({ rows: rows.slice(0, 80) })
    expect(result).toEqual(prefix)
    expect(result.executionAuthority).toBe('none')
    expect(result.futureRowsUsed).toBe(false)
  })

  it('statistical and volume paths retain historical prefix values after append or future mutation', () => {
    const full = buildMarketCentersSnapshot({ rows })
    const prefix = buildMarketCentersSnapshot({ rows: rows.slice(0, 80) })
    const observed = (path) =>
      path.map(({ centerStates, ...point }) => ({
        ...point,
        centerStates: {
          statisticalCenter: centerStates.statisticalCenter,
          vwapCost: centerStates.vwapCost,
          cohortCost: centerStates.cohortCost,
        },
      }))
    expect(observed(full.chartPath.slice(0, 80))).toEqual(observed(prefix.chartPath))
    const changed = rows.map((r, i) => (i >= 80 ? { ...r, close: 10000, high: 11000, low: 9000 } : r))
    expect(observed(buildMarketCentersSnapshot({ rows: changed }).chartPath.slice(0, 80))).toEqual(
      observed(prefix.chartPath),
    )
    expect(full.formulas.cohortCost.value).toBeNull()
    expect(full.formulas.supplyDemand.value).toBeNull()
    expect(full.formulas.fundamental.value).toBeNull()
  })

  it('uses conditional structural inputs only at their declared observation, without repainting history', () => {
    const config = defaultMarketCenterConfig()
    config.supplyDemand = { enabled: true, a: 200, b: 1, c: 0, d: 1, provenance: provenance(159) }
    config.fundamental = {
      enabled: true,
      nextDividend: 2,
      requiredReturn: 0.08,
      growthRate: 0.02,
      provenance: provenance(159),
    }
    const result = buildMarketCentersSnapshot({ rows, config })
    expect(result.formulas.supplyDemand.value).toBe(100)
    expect(result.formulas.fundamental.value).toBeCloseTo(100 / 3)
    expect(
      result.chartPath.slice(0, -1).every((p) => p.supplyDemandPrice === null && p.fundamentalPrice === null),
    ).toBe(true)
    const earlier = buildMarketCentersSnapshot({ rows, observationIndex: 100, config })
    expect(earlier.formulas.supplyDemand.value).toBeNull()
    expect(earlier.formulas.fundamental.value).toBeNull()
    expect(earlier.chartPath.every((p) => p.fundamentalPrice === null)).toBe(true)
  })

  it('keeps valid zero-dividend valuation available while leaving its logarithmic chart point empty', () => {
    const config = {
      fundamental: {
        enabled: true,
        nextDividend: 0,
        requiredReturn: 0.08,
        growthRate: 0.02,
        provenance: provenance(159),
      },
    }
    const result = buildMarketCentersSnapshot({ rows, config })
    expect(result.formulas.fundamental.value).toBe(0)
    expect(result.chartPath.at(-1).fundamentalPrice).toBeNull()
  })

  it('requires explicit amount/volume conversion instead of silently inferring units', () => {
    const values = rows.slice(0, 2).map((r) => ({ ...r, amount: 1000000 }))
    expect(buildMarketCentersSnapshot({ rows: values }).formulas.vwapCost.value).toBeNull()
    const config = { vwapCost: { lookback: 120, amountPerVolumeToPrice: 0.01 } }
    const result = buildMarketCentersSnapshot({ rows: values, config })
    expect(result.formulas.vwapCost.value).toBe(100)
    expect(result.chartPath.at(-1).centerStates.vwapCost.source.kind).toBe('amount-volume')
  })
})
