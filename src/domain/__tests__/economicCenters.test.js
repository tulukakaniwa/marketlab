import { describe, expect, it } from 'vitest'
import {
  buildEconomicCostPath,
  queryCohortTurnoverCostProxy,
  queryEconomicCenters,
  queryGordonValue,
  queryLinearSupplyDemandClearing,
  queryVwapCostProxy,
} from '../market-model/economicCenters.js'

const units = { price: 'CNY/share', volume: 'reported-volume' }
const bar = (date, price, volume = 100) => ({ date, high: price * 1.1, low: price * 0.9, close: price, volume })
const history = [bar('2026-10-01', 10), bar('2026-10-02', 20), bar('2026-10-03', 40)]
const proof = (date, kind = 'scenario') => ({
  kind,
  source: kind === 'observed' ? 'dated-publication' : 'user-input',
  asOfDate: date,
  availableAt: `${date}:close`,
})
const supplyDemand = {
  a: 100,
  b: 2,
  c: 10,
  d: 1,
  quantityUnit: 'shares/session',
  priceUnit: 'CNY/share',
  provenance: proof('2026-10-03'),
}
const gordon = {
  nextDividend: 2,
  requiredReturn: 0.1,
  growthRate: 0.02,
  dividendBasis: 'expected-next-period',
  period: 'year',
  priceUnit: 'CNY/share',
  provenance: proof('2026-10-03'),
}
function freeFloat(rows = history) {
  return {
    unit: 'shares',
    volumeUnit: units.volume,
    volumeToShares: 1,
    provenance: proof(rows[0].date, 'observed'),
    observations: rows.map(({ date }) => ({ date, value: 1000, provenance: proof(date, 'observed') })),
  }
}

describe('independent economic meanings', () => {
  it('returns separate formula contracts without deriving economic schedules from bars', () => {
    const result = queryEconomicCenters({ rows: history, units })
    expect(Object.keys(result.formulas)).toEqual(['vwapCost', 'cohortCost', 'supplyDemand', 'fundamental'])
    expect(result.formulas.vwapCost.value).toBeCloseTo(70 / 3, 12)
    for (const key of ['cohortCost', 'supplyDemand', 'fundamental']) {
      expect(result.formulas[key].value).toBeNull()
      expect(result.formulas[key].status).toBe('missing-input')
      expect(result.formulas[key].missingInputs.length).toBeGreaterThan(0)
    }
    for (const formula of Object.values(result.formulas)) {
      expect(formula.executionAuthority).toBe('none')
      expect(formula.futureRowsUsed).toBe(false)
      expect(formula.unit).toBeDefined()
      expect(formula.claimClass).toBeDefined()
    }
  })

  it('never reads future rows after an explicit observation index and preserves historical paths', () => {
    const future = new Proxy(
      {},
      {
        get() {
          throw new Error('future row read')
        },
      },
    )
    const params = { rows: history, observationIndex: 1, units, freeFloat: freeFloat() }
    expect(queryEconomicCenters({ ...params, rows: [...history.slice(0, 2), future] })).toEqual(
      queryEconomicCenters(params),
    )
    const fullPath = buildEconomicCostPath(history, { units, freeFloat: freeFloat(), lookback: 2 })
    expect(buildEconomicCostPath(history.slice(0, 2), { units, freeFloat: freeFloat(), lookback: 2 })).toEqual(
      fullPath.slice(0, 2),
    )
    const latest = queryEconomicCenters({ rows: history, units, freeFloat: freeFloat(), lookback: 2 })
    expect(latest.formulas.vwapCost).toEqual(fullPath.at(-1).vwapCost)
    expect(latest.formulas.cohortCost).toEqual(fullPath.at(-1).cohortCost)
  })

  it('restricts the window, rejects future context and validates closed-bar availability', () => {
    expect(queryVwapCostProxy({ rows: history, units, lookback: 1 }).value).toBeCloseTo(40, 12)
    expect(queryVwapCostProxy({ rows: history, units, observationDate: '2026-10-02' }).value).toBeCloseTo(15, 12)
    for (const params of [
      { rows: history, observationIndex: 2, observationDate: '2026-10-02' },
      { rows: [{ ...history[0], isClosed: false }] },
      { rows: [{ ...history[0], availableAt: '2026-10-02:close' }] },
      { rows: history, observationDate: '2026-02-30' },
      { rows: history, lookback: 1025 },
      { rows: [history[1], history[0]] },
    ])
      expect(queryVwapCostProxy(params).status).toBe('invalid-input')
  })
})

describe('volume centroid and explicit units', () => {
  it('distinguishes a trade-amount centroid from the HLC3 volume proxy', () => {
    const rows = [
      { ...bar('2026-10-01', 12, 2), high: 14, low: 10, amount: 2000 },
      { ...bar('2026-10-02', 22, 3), amount: 6000 },
    ]
    const amount = queryVwapCostProxy({ rows, units: { ...units, volume: 'lots', amountPerVolumeToPrice: 0.01 } })
    expect(amount.value).toBeCloseTo(16, 12)
    expect(amount.source.kind).toBe('amount-volume')
    const proxy = queryVwapCostProxy({ rows, units, basis: 'typical-price' })
    expect(proxy.value).toBeCloseTo(18, 12)
    expect(proxy.source.kind).toBe('hlc3-volume')
    expect(amount.claimClass).toBe('volume-centroid-proxy')
    expect(queryVwapCostProxy({ rows, units }).missingInputs).toContain('units.amountPerVolumeToPrice')
    expect(
      queryVwapCostProxy({
        rows: [rows[0], { ...rows[1], amount: undefined }],
        units: { ...units, amountPerVolumeToPrice: 0.01 },
      }).value,
    ).toBeNull()
  })

  it('preserves currency scaling and volume scaling while treating no trade as missing', () => {
    const result = queryVwapCostProxy({ rows: history, units })
    expect(
      queryVwapCostProxy({ rows: history.map((row) => ({ ...row, volume: row.volume * 5 })), units }).value,
    ).toBeCloseTo(result.value, 12)
    const scaled = history.map((row) => ({ ...row, high: row.high * 7, low: row.low * 7, close: row.close * 7 }))
    expect(queryVwapCostProxy({ rows: scaled, units }).value).toBeCloseTo(result.value * 7, 12)
    expect(queryVwapCostProxy({ rows: [bar('2026-10-01', 10, 0)], units }).value).toBeNull()
    expect(queryVwapCostProxy({ rows: [bar('2026-10-01', 10, -1)], units }).status).toBe('invalid-input')
    expect(queryVwapCostProxy({ rows: [{ ...history[0], high: 1 }], units }).value).toBeNull()
  })

  it('does not substitute HLC3 when a declared amount column is entirely missing', () => {
    const result = queryVwapCostProxy({
      rows: history.map((row) => ({ ...row, amount: null })),
      units: { ...units, amountPerVolumeToPrice: 1 },
    })
    expect(result.source.kind).toBe('amount-volume')
    expect(result.value).toBeNull()
    expect(result.missingInputs).toContain('amount-for-each-traded-bar')
  })

  it('rejects notional conversion or adjustment mismatch instead of inventing a price outside the daily range', () => {
    const row = { ...bar('2026-10-01', 10), amount: 1000 }
    const declared = { ...units, amountPerVolumeToPrice: 1 }
    expect(queryVwapCostProxy({ rows: [row], units: declared }).value).toBe(10)
    for (const conversion of [0.01, 100]) {
      const result = queryVwapCostProxy({ rows: [row], units: { ...declared, amountPerVolumeToPrice: conversion } })
      expect(result.value).toBeNull()
      expect(result.status).toBe('invalid-input')
      expect(result.missingInputs).toContain('amount-price-basis-mismatch')
    }
    for (const change of [{ high: 0 }, { low: Number.NaN }, { close: 12 }, { low: 12 }])
      expect(queryVwapCostProxy({ rows: [{ ...row, ...change }], units: declared }).value).toBeNull()
    expect(
      queryCohortTurnoverCostProxy({
        rows: [row],
        units: { ...declared, amountPerVolumeToPrice: 100 },
        freeFloat: freeFloat([row]),
      }).value,
    ).toBeNull()
  })

  it('keeps inclusive range boundaries and a relative roundoff allowance across price scales', () => {
    for (const scale of [1e-6, 1, 1e6]) {
      const row = { ...bar('2026-10-01', 10 * scale), volume: 1 }
      const declared = { ...units, amountPerVolumeToPrice: 1 }
      for (const amount of [row.low, row.high, row.low * (1 - 1e-11), row.high * (1 + 1e-11)])
        expect(queryVwapCostProxy({ rows: [{ ...row, amount }], units: declared }).status).toBe('ready')
      for (const amount of [row.low * (1 - 1e-8), row.high * (1 + 1e-8)])
        expect(queryVwapCostProxy({ rows: [{ ...row, amount }], units: declared }).value).toBeNull()
    }
  })
})

describe('observed float and explicitly assumed cohort replacement', () => {
  it('retains unknown initial inventory and solves the two-session conditional cohort mixture', () => {
    const rows = history.slice(0, 2)
    const result = queryCohortTurnoverCostProxy({ rows, units, freeFloat: freeFloat(rows) })
    const survivor = Math.exp(-0.1)
    expect(result.coverage).toBeCloseTo(1 - survivor ** 2, 12)
    expect(result.unknownFraction).toBeCloseTo(survivor ** 2, 12)
    expect(result.value).toBeCloseTo((10 * survivor + 20) / (1 + survivor), 12)
    expect(result.claimClass).toBe('turnover-cohort-proxy')
    expect(result.replacementModel).toBe('poisson-random-replacement')
    expect(result.assumptions.join(' ')).toContain('not observed unique turnover')
  })

  it('requires independently proven volume conversion and same-day float, without filling missing days', () => {
    const float = freeFloat()
    for (const changed of [
      undefined,
      { ...float, volumeToShares: undefined },
      { ...float, volumeUnit: 'shares' },
      { ...float, provenance: proof('2026-10-01') },
      { ...float, observations: float.observations.slice(1) },
      {
        ...float,
        observations: [
          { ...float.observations[0], provenance: proof('2026-10-02', 'observed') },
          ...float.observations.slice(1),
        ],
      },
      {
        ...float,
        observations: [
          {
            ...float.observations[0],
            provenance: { ...proof('2026-10-01', 'observed'), availableAt: '2026-10-02:close' },
          },
          ...float.observations.slice(1),
        ],
      },
    ])
      expect(queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: changed }).value).toBeNull()
  })

  it('preserves ratios under explicit lots/shares conversion and ignores unused future float errors', () => {
    const original = queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: freeFloat() })
    const converted = queryCohortTurnoverCostProxy({
      rows: history.map((row) => ({ ...row, volume: row.volume / 100 })),
      units: { ...units, volume: 'lots' },
      freeFloat: { ...freeFloat(), volumeUnit: 'lots', volumeToShares: 100 },
    })
    expect(converted.value).toBeCloseTo(original.value, 12)
    expect(converted.coverage).toBeCloseTo(original.coverage, 12)
    const float = freeFloat()
    float.observations.push({ date: '2027-01-01', value: -1 }, { date: '2027-01-01' }, { date: 'invalid' })
    expect(queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: float })).toEqual(original)
  })

  it('preserves share-population scaling and rejects ambiguous, unproven or zero-trade cohorts', () => {
    const float = freeFloat()
    const original = queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: float })
    const scaled = queryCohortTurnoverCostProxy({
      rows: history.map((row) => ({ ...row, volume: row.volume * 10 })),
      units,
      freeFloat: { ...float, observations: float.observations.map((point) => ({ ...point, value: point.value * 10 })) },
    })
    expect(scaled.value).toBeCloseTo(original.value, 12)
    expect(scaled.coverage).toBeCloseTo(original.coverage, 12)
    const duplicated = { ...float, observations: [...float.observations, float.observations[0]] }
    expect(queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: duplicated }).status).toBe('invalid-input')
    const unproven = { ...float, provenance: { ...float.provenance, source: '' } }
    expect(queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: unproven }).value).toBeNull()
    const noTrade = history.map((row) => ({ ...row, volume: 0 }))
    expect(queryCohortTurnoverCostProxy({ rows: noTrade, units, freeFloat: float }).value).toBeNull()
  })

  it('future revisions of an old session leave every past cost and its metadata unchanged', () => {
    const float = freeFloat()
    const revised = {
      ...float,
      observations: [
        ...float.observations,
        ...float.observations.map((point) => ({
          ...point,
          value: point.value * 100,
          provenance: { ...point.provenance, availableAt: '2027-01-01:close' },
        })),
      ],
    }
    const before = buildEconomicCostPath(history, { units, freeFloat: float, lookback: 2 })
    expect(before.every((point) => Number.isFinite(point.cohortCostPrice))).toBe(true)
    expect(buildEconomicCostPath(history, { units, freeFloat: revised, lookback: 2 })).toEqual(before)
    const onlyFuture = { ...float, observations: revised.observations.slice(float.observations.length) }
    const missing = queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: onlyFuture })
    expect(missing.value).toBeNull()
    expect(missing.status).toBe('missing-input')
  })

  it('does not hide malformed time proofs or same-day duplicates as future revisions', () => {
    const float = freeFloat()
    for (const availableAt of [undefined, '2027-01-01:unknown', '2027-02-30:close', '2026-10-01:close']) {
      const broken = { ...float.observations[0], provenance: { ...float.observations[0].provenance, availableAt } }
      const ambiguous = { ...float, observations: [...float.observations, broken] }
      expect(queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: ambiguous }).status).toBe('invalid-input')
      if (availableAt !== '2026-10-01:close') {
        const invalid = { ...float, observations: [broken, ...float.observations.slice(1)] }
        expect(queryCohortTurnoverCostProxy({ rows: history, units, freeFloat: invalid }).status).toBe('invalid-input')
      }
    }
  })
})

describe('conditional structural and fundamental models', () => {
  it('solves the declared schedules and respects price/quantity unit changes', () => {
    const result = queryLinearSupplyDemandClearing({ observationDate: '2026-10-03', supplyDemand })
    expect(result.value).toBe(30)
    expect(result.quantity).toBe(40)
    expect(supplyDemand.a - supplyDemand.b * result.value).toBe(supplyDemand.c + supplyDemand.d * result.value)
    expect(result.state).toBe('scenario')
    const currencyScaled = queryLinearSupplyDemandClearing({
      observationDate: '2026-10-03',
      supplyDemand: { ...supplyDemand, b: 0.2, d: 0.1 },
    })
    expect(currencyScaled.value).toBeCloseTo(300, 12)
    expect(currencyScaled.quantity).toBeCloseTo(result.quantity, 12)
    const quantityScaled = queryLinearSupplyDemandClearing({
      observationDate: '2026-10-03',
      supplyDemand: { ...supplyDemand, a: 1000, b: 20, c: 100, d: 10 },
    })
    expect(quantityScaled.value).toBe(result.value)
    expect(quantityScaled.quantity).toBe(result.quantity * 10)
    for (const change of [
      { b: 0 },
      { d: -1 },
      { a: 0 },
      { a: 1, c: -100 },
      { quantityUnit: null },
      { provenance: null },
    ])
      expect(
        queryLinearSupplyDemandClearing({ observationDate: '2026-10-03', supplyDemand: { ...supplyDemand, ...change } })
          .value,
      ).toBeNull()
  })

  it('values as-of expected dividends, distinguishes zero dividends from missing, and enforces convergence', () => {
    const result = queryGordonValue({ observationDate: '2026-10-03', gordon })
    expect(result.value).toBe(25)
    expect(result.inputSemantics).toBe('expected-next-period-dividend')
    expect(queryGordonValue({ observationDate: '2026-10-03', gordon: { ...gordon, nextDividend: 0 } }).value).toBe(0)
    expect(queryGordonValue({ observationDate: '2026-10-03', gordon: { ...gordon, nextDividend: 20 } }).value).toBe(250)
    for (const change of [
      { nextDividend: null },
      { nextDividend: -1 },
      { growthRate: 0.1 },
      { growthRate: -1 },
      { dividendBasis: 'realized-next-period' },
      { period: null },
    ])
      expect(queryGordonValue({ observationDate: '2026-10-03', gordon: { ...gordon, ...change } }).value).toBeNull()
    expect(
      queryGordonValue({
        observationDate: '2026-10-03',
        gordon: { ...gordon, provenance: proof('2026-10-03', 'observed') },
      }).state,
    ).toBe('observed')
  })

  it('refuses to use current scenarios or delayed publications at historical observation points', () => {
    for (const kind of ['scenario', 'observed']) {
      const provenance = proof('2026-10-03', kind)
      const result = queryEconomicCenters({
        rows: history,
        observationIndex: 1,
        supplyDemand: { ...supplyDemand, provenance },
        gordon: { ...gordon, provenance },
      })
      expect(result.formulas.supplyDemand.value).toBeNull()
      expect(result.formulas.fundamental.value).toBeNull()
      const delayed = { ...proof('2026-10-02', kind), availableAt: '2026-10-03:close' }
      expect(
        queryGordonValue({ observationDate: '2026-10-02', gordon: { ...gordon, provenance: delayed } }).value,
      ).toBeNull()
    }
  })

  it('does not mutate inputs or emit nonfinite prices even for extreme finite inputs', () => {
    const rows = Object.freeze(history.map((row) => Object.freeze({ ...row })))
    const result = queryEconomicCenters({
      rows,
      units,
      supplyDemand: Object.freeze(supplyDemand),
      gordon: Object.freeze(gordon),
    })
    expect(result.formulas.vwapCost.value).toBeCloseTo(70 / 3, 12)
    const extreme = queryGordonValue({
      observationDate: '2026-10-03',
      gordon: { ...gordon, nextDividend: 1e308, requiredReturn: 1e-308, growthRate: 0 },
    })
    expect(extreme.value).toBeNull()
    expect(extreme.status).toBe('invalid-input')
  })
})
