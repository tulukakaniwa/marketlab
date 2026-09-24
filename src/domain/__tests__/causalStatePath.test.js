import { describe, expect, it } from 'vitest'
import { buildCausalStatePath, CAUSAL_STATE_ASSUMPTIONS } from '../market-model/causalStatePath.js'

const options = { tradingDaysPerYear: 252 }

function rowsFrom(prices, offset = 0) {
  return prices.map((close, index) => ({
    date: new Date(Date.UTC(2024, 0, 1 + index + offset)).toISOString().slice(0, 10),
    close,
  }))
}

function sampleRows(length = 100) {
  return rowsFrom(Array.from({ length }, (_, index) => 100 * Math.exp(0.001 * index + 0.02 * Math.sin(index / 3))))
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0)
}

describe('causal market state path', () => {
  it('does not revise any earlier state when future rows are appended', () => {
    const rows = sampleRows()
    const prefix = buildCausalStatePath(rows.slice(0, 45), options)
    const full = buildCausalStatePath(rows, options)
    expect(full.slice(0, 45)).toEqual(prefix)
    for (let end = 1; end < 45; end += 7) {
      expect(buildCausalStatePath(rows.slice(0, end), options).at(-1)).toEqual(prefix[end - 1])
    }
  })

  it('isolates all earlier states from arbitrary future price changes', () => {
    const rows = sampleRows()
    const changed = rows.map((row, index) => ({
      ...row,
      close: index >= 50 ? row.close * (index % 2 ? 4 : 0.1) : row.close,
    }))
    const original = buildCausalStatePath(rows, options)
    const perturbed = buildCausalStatePath(changed, options)
    expect(perturbed.slice(0, 50)).toEqual(original.slice(0, 50))
    expect(perturbed[50].equilibrium).not.toEqual(original[50].equilibrium)
  })

  it('scores a surprise with yesterday noise and parameters before learning from it', () => {
    const rows = rowsFrom(Array(30).fill(100))
    const shockRows = rows.map((row, index) => ({ ...row, close: index === 25 ? 160 : row.close }))
    const calm = buildCausalStatePath(rows, options)
    const shock = buildCausalStatePath(shockRows, options)
    expect(shock[25].predictionAudit).toEqual(calm[25].predictionAudit)
    expect(shock[25].predictionAudit.parametersThrough).toBe(rows[24].date)
    expect(shock[25].predictionAudit.innovationVariancePerSession).toBe(shock[24].volatility.variancePerSession)
    expect(shock[25].predictionAudit.kalman.observationVariance).toBe(
      CAUSAL_STATE_ASSUMPTIONS.equilibriumObservationNoiseRatio * shock[24].volatility.variancePerSession,
    )
    expect(shock[25].assimilation.logLikelihoods).not.toEqual(calm[25].assimilation.logLikelihoods)
    expect(shock[25].dynamics.components.find((component) => component.id === 'shock').weight).toBeGreaterThan(0.99)
    expect(shock[25].volatility.variancePerSession).toBeGreaterThan(calm[25].volatility.variancePerSession)
    expect(shock[26].predictionAudit.kalman.observationVariance).toBeGreaterThan(
      calm[26].predictionAudit.kalman.observationVariance,
    )
    expect(shock[25].equilibrium.price).toBeGreaterThan(100)
    expect(shock[25].equilibrium.price).toBeLessThan(160)
    expect(shock[25].parametersThrough).toBe(rows[25].date)
    expect(shock[25].asOfDate).toBe(rows[25].date)
    expect(shock[25].availableAt).toBe(`${rows[25].date}:close`)
  })

  it('keeps every regime vector and transition row probabilistically coherent', () => {
    const rows = sampleRows(400).map((row, index) => ({ ...row, close: row.close * (index === 100 ? 1.5 : 1) }))
    for (const state of buildCausalStatePath(rows, options)) {
      expect(state.status).not.toBe('invalid-data')
      expect(state.dynamics.components.map((component) => component.id)).toEqual(['reversion', 'trend', 'shock'])
      const weights = state.dynamics.components.map((component) => component.weight)
      expect(sum(weights)).toBeCloseTo(1, 12)
      expect(weights.every((weight) => weight >= 0 && weight <= 1)).toBe(true)
      for (const row of state.dynamics.transitionMatrix) {
        expect(row).toHaveLength(3)
        expect(sum(row)).toBeCloseTo(1, 12)
        expect(row.every((weight) => weight > 0 && weight <= 1)).toBe(true)
      }
      for (const component of state.dynamics.components) {
        expect(component.variancePerSession).toBeGreaterThan(0)
        expect(component.reversionRate).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(component.driftPerSession)).toBe(true)
      }
      expect(state.volatility.nextSessionPredictiveVariance).toBeGreaterThan(0)
      expect(state.volatility.annualized ** 2 / options.tradingDaysPerYear).toBeCloseTo(
        state.volatility.nextSessionPredictiveVariance,
        12,
      )
      expect(state.volatility.annualizedBasis).toBe('next-session-mixture-predictive-variance')
      expect(state.volatility.innovationAnnualized ** 2 / options.tradingDaysPerYear).toBeCloseTo(
        state.volatility.variancePerSession,
        12,
      )
      expect(state.volatility.annualized).toBeGreaterThanOrEqual(state.volatility.innovationAnnualized)
      expect(state.futureRowsUsed).toBe(false)
      expect(state.executionAuthority).toBe('none')
    }
  })

  it('is equivariant to the currency unit and share-price scale', () => {
    const rows = sampleRows(90)
    const original = buildCausalStatePath(rows, options)
    const scaled = buildCausalStatePath(
      rows.map((row) => ({ ...row, close: row.close * 7 })),
      options,
    )
    for (let index = 0; index < original.length; index += 1) {
      const left = original[index]
      const right = scaled[index]
      expect(right.equilibrium.price).toBeCloseTo(left.equilibrium.price * 7, 8)
      expect(right.equilibrium.logPrice - left.equilibrium.logPrice).toBeCloseTo(Math.log(7), 12)
      expect(right.equilibrium.logVariance).toBeCloseTo(left.equilibrium.logVariance, 12)
      expect(right.equilibrium.driftPerSession).toBeCloseTo(left.equilibrium.driftPerSession, 12)
      expect(right.volatility.variancePerSession).toBeCloseTo(left.volatility.variancePerSession, 12)
      for (let regime = 0; regime < 3; regime += 1) {
        expect(right.dynamics.components[regime].weight).toBeCloseTo(left.dynamics.components[regime].weight, 10)
        expect(right.dynamics.components[regime].reversionRate).toBeCloseTo(
          left.dynamics.components[regime].reversionRate,
          10,
        )
      }
    }
  })

  it('changes only annualization when the declared annual session count changes', () => {
    const rows = sampleRows(30)
    const market252 = buildCausalStatePath(rows, options).at(-1)
    const market365 = buildCausalStatePath(rows, { tradingDaysPerYear: 365 }).at(-1)
    expect(market365.equilibrium).toEqual(market252.equilibrium)
    expect(market365.dynamics).toEqual(market252.dynamics)
    expect(market365.volatility.variancePerSession).toBe(market252.volatility.variancePerSession)
    expect(market365.volatility.annualized / market252.volatility.annualized).toBeCloseTo(Math.sqrt(365 / 252), 12)
  })

  it('keeps a constant path finite without inventing drift or data-driven reversion evidence', () => {
    const states = buildCausalStatePath(rowsFrom(Array(1500).fill(100)), options)
    expect(states[0].status).toBe('warming-up')
    expect(states.at(-1).status).toBe('ready')
    expect(states[0].predictionAudit.status).toBe('segment-initialization-no-predictive-density')
    for (const state of [states[0], states[30], states.at(-1)]) {
      expect(state.equilibrium.price).toBeCloseTo(100, 10)
      expect(state.equilibrium.driftPerSession).toBe(0)
      expect(state.dynamics.components.find((component) => component.id === 'trend').driftPerSession).toBe(0)
      expect(state.dynamics.components.find((component) => component.id === 'reversion').reversionRate).toBeCloseTo(
        CAUSAL_STATE_ASSUMPTIONS.initialReversionRate,
        12,
      )
      expect(state.volatility.variancePerSession).toBeGreaterThanOrEqual(CAUSAL_STATE_ASSUMPTIONS.varianceFloor)
      expect(state.modelAssumptions.minimumContiguousObservations).toBeGreaterThan(1)
      expect(state.assumptions.join(' ')).toContain('not joint Bayesian')
    }
  })

  it.each([
    [{ close: NaN }, 'invalid-close-price'],
    [{ close: Infinity }, 'invalid-close-price'],
    [{ close: 0 }, 'invalid-close-price'],
    [{ close: -1 }, 'invalid-close-price'],
    [{ isClosed: false }, 'unclosed-session'],
    [{ closed: false }, 'unclosed-session'],
    [{ high: 80 }, 'inconsistent-ohlc-range'],
    [{ volume: -1 }, 'invalid-volume'],
    [{ date: '2024-02-30' }, 'invalid-session-date'],
  ])('breaks adjacency on invalid input %o instead of learning a cross-gap return', (patch, reason) => {
    const rows = sampleRows(20)
    rows[10] = { ...rows[10], ...patch }
    rows[11] = { ...rows[11], close: 250 }
    const states = buildCausalStatePath(rows, options)
    expect(states[10]).toMatchObject({ status: 'invalid-data', reason, sampleSize: 0, parametersThrough: null })
    expect(states[10].dynamics.components).toEqual([])
    expect(states[11]).toMatchObject({ status: 'warming-up', sampleSize: 1, assimilation: null })
    expect(states[11].predictionAudit.parametersThrough).toBeNull()
    expect(states[11].equilibrium.price).toBeCloseTo(250, 10)
    expect(states[11].volatility.variancePerSession).toBe(CAUSAL_STATE_ASSUMPTIONS.initialVariancePerSession)
    expect(states[12].predictionAudit.parametersThrough).toBe(rows[11].date)
  })

  it('rejects repeated dates and starts a fresh segment afterward', () => {
    const rows = sampleRows(20)
    rows[10] = { ...rows[10], date: rows[9].date }
    const states = buildCausalStatePath(rows, options)
    expect(states[10].reason).toBe('non-increasing-session-date')
    expect(states[11].sampleSize).toBe(1)
    expect(states[11].assimilation).toBeNull()
  })

  it('does not skip sparse missing rows and thereby bridge a missing session', () => {
    const rows = sampleRows(20)
    delete rows[10]
    const states = buildCausalStatePath(rows, options)
    expect(states).toHaveLength(20)
    expect(states[10]).toMatchObject({ status: 'invalid-data', reason: 'invalid-session-date' })
    expect(states[11]).toMatchObject({ status: 'warming-up', sampleSize: 1, assimilation: null })
  })

  it('accepts closed CSV rows without wall-clock checks and handles empty or bad calendar input', () => {
    const futureRows = rowsFrom([100, 101]).map((row) => ({ ...row, date: row.date.replace('2024', '2099') }))
    expect(buildCausalStatePath(futureRows, options).every((state) => state.status === 'warming-up')).toBe(true)
    expect(buildCausalStatePath([], options)).toEqual([])
    expect(buildCausalStatePath(null, options)).toEqual([])
    expect(buildCausalStatePath(futureRows, { tradingDaysPerYear: 0 })[0].reason).toBe('invalid-trading-days-per-year')
    expect(buildCausalStatePath(futureRows)[0].status).toBe('invalid-data')
  })

  it('does not share mutable assumptions or state between rows or calls', () => {
    const rows = sampleRows(12).map((row) => Object.freeze(row))
    const first = buildCausalStatePath(Object.freeze(rows), options)
    const clean = buildCausalStatePath(rows, options)
    first[0].modelAssumptions.initialTransitionMatrix[0][0] = 0
    first[0].dynamics.transitionMatrix[0][0] = 0
    first[0].assumptions.push('changed by caller')
    expect(first[1]).toEqual(clean[1])
    expect(buildCausalStatePath(rows, options)).toEqual(clean)
  })
})
