import { describe, expect, it } from 'vitest'
import {
  buildStatisticalCenterPath,
  buildStatisticalCenterSnapshot,
  STATISTICAL_CENTER_DEFAULTS,
} from '../market-model/statisticalCenter.js'

function gaussian(seed = 14) {
  let value = seed >>> 0
  const uniform = () => {
    value = (1664525 * value + 1013904223) >>> 0
    return (value + 0.5) / 4294967296
  }
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform())
}
function date(index) {
  return new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10)
}
function observations(kind = 'stationary', { phi = 0.6, length = 500, center = 100 } = {}) {
  const normal = gaussian()
  let x = 0
  return Array.from({ length }, (_, index) => {
    x =
      kind === 'stationary'
        ? phi * x + 0.02 * normal()
        : kind === 'random-walk'
          ? x + 0.02 * normal()
          : 0.004 * index + 0.002 * normal()
    return { date: date(index), close: center * Math.exp(x) }
  })
}

describe('statistical regression center', () => {
  it('identifies an independently generated stationary log AR(1), not a moving Kalman level', () => {
    const snapshot = buildStatisticalCenterSnapshot({ rows: observations() })
    expect(snapshot.status).toBe('ready')
    expect(snapshot.fitObject).toBe('constant-mean-log-price-ar1')
    expect(snapshot.parameters).toMatchObject(STATISTICAL_CENTER_DEFAULTS)
    expect(snapshot.autoregression.phi).toBeCloseTo(0.6, 1)
    expect(snapshot.value).toBeCloseTo(100, 0)
    expect(snapshot.center.price).toBe(snapshot.value)
    expect(snapshot.center.price).toBeCloseTo(Math.exp(snapshot.center.logPrice), 12)
    expect(snapshot.halfLifeSessions).toBeCloseTo(Math.log(0.5) / Math.log(snapshot.autoregression.phi), 12)
    expect(snapshot.response).toBe('monotone-decay')
    expect(snapshot.uncertainty.centerLogStandardError).toBeGreaterThan(0)
    expect(snapshot.uncertainty.includesModelSelectionUncertainty).toBe(false)
    expect(snapshot.executionAuthority).toBe('none')
    expect(snapshot.availableAt).toBe(`${date(499)}:close`)
  })

  it('uses the MacKinnon finite-sample DF law rather than ordinary OLS t critical values', () => {
    const snapshot = buildStatisticalCenterSnapshot({ rows: observations() })
    const { unitRootTest: test, autoregression: ar } = snapshot
    const n = snapshot.window.regressionObservations
    expect(test).toMatchObject({
      method: 'Dickey-Fuller',
      lags: 0,
      regression: 'constant-no-trend',
      significance: 0.05,
    })
    expect(test.statistic).toBeCloseTo(ar.delta / ar.coefficientStandardError, 12)
    expect(test.criticalValues['5%']).toBeCloseTo(-2.86154 - 2.8903 / n - 4.234 / n ** 2 - 40.04 / n ** 3, 12)
    expect(test.criticalValues['1%']).toBeCloseTo(-3.43035 - 6.5393 / n - 16.786 / n ** 2 - 79.433 / n ** 3, 12)
    expect(test.criticalValues['10%']).toBeCloseTo(-2.56677 - 1.5384 / n - 2.809 / n ** 2, 12)
    expect(test.rejectNull).toBe(true)
    expect(test.pValue).toBeNull()
    expect(snapshot.assumptions.join(' ')).toContain('lag 0 assumes uncorrelated')
    expect(snapshot.assumptions.join(' ')).toContain('does not prove stationarity')
  })

  it('matches an independent statsmodels 0.14.4 lag-zero fixture and coefficient covariance', () => {
    // Generated from the same independent observations with adfuller(log(close),
    // maxlag=0, regression='c', autolag=None), plus OLS delta-method covariance.
    const snapshot = buildStatisticalCenterSnapshot({ rows: observations() })
    expect(snapshot.autoregression.phi).toBeCloseTo(0.6165525799696125, 12)
    expect(snapshot.unitRootTest.statistic).toBeCloseTo(-5.254924416726089, 11)
    expect(snapshot.unitRootTest.criticalValues['5%']).toBeCloseTo(-2.8861509858476264, 12)
    // acorr_ljungbox(the OLS residuals, lags=[5], model_df=1), same external fixture.
    expect(snapshot.residualTest).toMatchObject({
      method: 'Ljung-Box',
      role: 'assumption-gate',
      lags: 5,
      modelDegreesOfFreedom: 1,
      degreesOfFreedom: 4,
      referenceDistribution: 'asymptotic-chi-square',
      rejectNull: false,
    })
    expect(snapshot.residualTest.statistic).toBeCloseTo(5.878457697048443, 11)
    expect(snapshot.residualTest.pValue).toBeCloseTo(0.2084108581327873, 12)
    expect(snapshot.residualTest.criticalValue).toBeCloseTo(9.487729036781154, 12)
    expect(snapshot.value).toBeCloseTo(99.60010407049188, 10)
    expect(snapshot.uncertainty.centerLogStandardError).toBeCloseTo(0.004681825565741084, 12)
  })

  it('refuses a curved log trajectory whose DF rejection falsely suggests a constant mean', () => {
    const rows = Array.from({ length: 150 }, (_, index) => ({ date: date(index), close: 100 + index / 3 }))
    const snapshot = buildStatisticalCenterSnapshot({ rows })
    expect(snapshot.unitRootTest.rejectNull).toBe(true)
    expect(snapshot.autoregression.phi).toBeLessThan(1)
    expect(snapshot.residualTest.rejectNull).toBe(true)
    expect(snapshot.reason).toBe('residual-autocorrelation-rejected')
    expect(snapshot.status).toBe('unidentified')
    expect(snapshot.value).toBeNull()
    expect(snapshot.center.price).toBeNull()
    expect(snapshot.uncertainty).toBeNull()
    expect(buildStatisticalCenterPath(rows).every((point) => point.value === null)).toBe(true)
  })

  it('rejects a stationary process with colored innovations instead of publishing a misspecified AR(1) center', () => {
    const normal = gaussian()
    let prior = 0,
      current = 0,
      x = 0
    const rows = Array.from({ length: 500 }, (_, index) => {
      // Innovation has a lag-2 AR component, while the fitted candidate stays AR(1).
      const next = 0.8 * prior + 0.02 * normal()
      prior = current
      current = next
      x = 0.4 * x + next
      return { date: date(index), close: 100 * Math.exp(x) }
    })
    const snapshot = buildStatisticalCenterSnapshot({ rows })
    expect(snapshot.unitRootTest.rejectNull).toBe(true)
    expect(Math.abs(snapshot.autoregression.phi)).toBeLessThan(1)
    expect(snapshot.residualTest.autocorrelations[1]).toBeGreaterThan(0.5)
    expect(snapshot.residualTest.rejectNull).toBe(true)
    expect(snapshot.status).toBe('unidentified')
    expect(snapshot.reason).toBe('residual-autocorrelation-rejected')
    expect(snapshot.value).toBeNull()
    expect(snapshot.halfLifeSessions).toBeNull()
  })

  it('keeps a stochastic trend with persistent positive drift unidentified', () => {
    const normal = gaussian()
    let x = 0
    const rows = Array.from({ length: 500 }, (_, index) => {
      x += 0.01 + 0.02 * normal()
      return { date: date(index), close: 100 * Math.exp(x) }
    })
    const snapshot = buildStatisticalCenterSnapshot({ rows })
    expect(snapshot.status).toBe('unidentified')
    expect(snapshot.unitRootTest.rejectNull).toBe(false)
    expect(snapshot.value).toBeNull()
  })

  it.each(['random-walk', 'trend'])('does not publish a false center for this %s process', (kind) => {
    const snapshot = buildStatisticalCenterSnapshot({ rows: observations(kind) })
    expect(snapshot.status).toBe('unidentified')
    expect(snapshot.unitRootTest.rejectNull).toBe(false)
    expect(snapshot.value).toBeNull()
    expect(snapshot.center.price).toBeNull()
    expect(snapshot.halfLifeSessions).toBeNull()
    expect(snapshot.uncertainty).toBeNull()
  })

  it('allows oscillating stable dynamics and does not clip kappa into a positive monotone range', () => {
    const oscillating = buildStatisticalCenterSnapshot({ rows: observations('stationary', { phi: -0.6 }) })
    expect(oscillating.status).toBe('ready')
    expect(oscillating.autoregression.phi).toBeCloseTo(-0.6, 1)
    expect(oscillating.autoregression.reversionRate).toBeGreaterThan(1)
    expect(oscillating.response).toBe('oscillating-decay')
    expect(oscillating.halfLifeSessions).toBeCloseTo(
      Math.log(0.5) / Math.log(Math.abs(oscillating.autoregression.phi)),
      12,
    )
    const explosive = Array.from({ length: 120 }, (_, index) => ({
      date: date(index),
      close: Math.exp(0.0001 * index ** 2),
    }))
    const rejected = buildStatisticalCenterSnapshot({ rows: explosive })
    expect(rejected.autoregression.phi).toBeGreaterThan(1)
    expect(rejected.autoregression.reversionRate).toBeLessThan(0)
    expect(rejected.reason).toBe('nonstationary-ar-coefficient')
    expect(rejected.value).toBeNull()
  })

  it('never reads a future row, even for validation, and has prefix-invariant historical fits', () => {
    const rows = observations('stationary', { length: 170 })
    const before = buildStatisticalCenterSnapshot({ rows: rows.slice(0, 150) })
    const guardedRows = new Proxy(rows, {
      get(target, key) {
        if (/^\d+$/.test(String(key)) && Number(key) > 149) throw new Error('future row read')
        return Reflect.get(target, key)
      },
    })
    expect(buildStatisticalCenterSnapshot({ rows: guardedRows, observationIndex: 149 })).toEqual(before)
    const prefix = buildStatisticalCenterPath(rows.slice(0, 150))
    const changed = rows.map((row, index) => (index >= 150 ? { ...row, close: NaN, closed: false } : row))
    expect(buildStatisticalCenterPath(changed).slice(0, 150)).toEqual(prefix)
    expect(buildStatisticalCenterPath(rows).slice(0, 150)).toEqual(prefix)
    expect(prefix.at(-1)).toEqual(before)
  })

  it('uses only the declared trailing window for fitting and is equivariant to price scaling', () => {
    const rows = observations()
    const base = buildStatisticalCenterSnapshot({ rows })
    const irrelevant = rows.map((row, index) => (index < 380 ? { ...row, close: row.close * 100 } : row))
    expect(buildStatisticalCenterSnapshot({ rows: irrelevant })).toEqual(base)
    const scaled = buildStatisticalCenterSnapshot({ rows: rows.map((row) => ({ ...row, close: row.close * 7 })) })
    expect(scaled.status).toBe(base.status)
    expect(scaled.value).toBeCloseTo(base.value * 7, 9)
    expect(scaled.center.logPrice - base.center.logPrice).toBeCloseTo(Math.log(7), 12)
    expect(scaled.autoregression.phi).toBeCloseTo(base.autoregression.phi, 12)
    expect(scaled.unitRootTest.statistic).toBeCloseTo(base.unitRootTest.statistic, 10)
    expect(scaled.residualTest.statistic).toBeCloseTo(base.residualTest.statistic, 10)
    expect(scaled.residualTest.pValue).toBeCloseTo(base.residualTest.pValue, 11)
    expect(scaled.uncertainty.centerLogStandardError).toBeCloseTo(base.uncertainty.centerLogStandardError, 12)
    expect(scaled.halfLifeSessions).toBeCloseTo(base.halfLifeSessions, 12)
    expect(base.window).toMatchObject({
      startDate: date(380),
      startIndex: 380,
      observations: 120,
      regressionObservations: 119,
    })
  })

  it('breaks the prefix at a late-available bar and can resume on subsequent known closed bars', () => {
    const rows = observations('stationary', { length: 170 }).map((row) => ({
      ...row,
      availableAt: `${row.date}:close`,
    }))
    rows[90].availableAt = `${date(91)}:close`
    const path = buildStatisticalCenterPath(rows)
    expect(path[90]).toMatchObject({
      status: 'invalid-data',
      reason: 'bar-not-available-at-close',
      value: null,
      availableAt: null,
    })
    expect(path[91].window.observations).toBe(1)
    expect(path[149].status).toBe('warming-up')
    expect(path[150].window).toMatchObject({ observations: 60, startDate: date(91) })
    expect(buildStatisticalCenterSnapshot({ rows, observationIndex: 90 })).toEqual(path[90])
    const ownClosed = observations().map((row) => ({ ...row, availableAt: `${row.date}:close` }))
    expect(buildStatisticalCenterSnapshot({ rows: ownClosed }).status).toBe('ready')
    expect(buildStatisticalCenterSnapshot({ rows: ownClosed }).value).toBeCloseTo(99.60010407049188, 10)
  })

  it.each([
    [{ close: 0 }, 'invalid-close-price'],
    [{ close: NaN }, 'invalid-close-price'],
    [{ closed: false }, 'unclosed-session'],
    [{ date: '2024-02-30' }, 'invalid-session-date'],
    [null, 'invalid-session-date'],
  ])('breaks an invalid learning segment %o without fitting a return across it', (patch, reason) => {
    const rows = observations('stationary', { length: 170 })
    rows[90] = patch === null ? null : { ...rows[90], ...patch }
    const path = buildStatisticalCenterPath(rows)
    expect(path[90]).toMatchObject({ status: 'invalid-data', reason, value: null, availableAt: null })
    expect(path[91]).toMatchObject({ status: 'warming-up', value: null })
    expect(path[91].window.observations).toBe(1)
    expect(path[149]).toMatchObject({ status: 'warming-up', value: null })
    expect(path[150].window.observations).toBe(60)
    expect(path[150].window.startDate).toBe(date(91))
  })

  it('does not invent a center or a test for constant prices and deterministic zero innovations', () => {
    const constant = Array.from({ length: 120 }, (_, index) => ({ date: date(index), close: 100 }))
    const flat = buildStatisticalCenterSnapshot({ rows: constant })
    expect(flat.reason).toBe('degenerate-price-window')
    expect(flat.value).toBeNull()
    expect(flat.unitRootTest).toBeNull()
    const deterministic = constant.map((row, index) => ({ ...row, close: 100 * Math.exp(0.002 * index) }))
    const linear = buildStatisticalCenterSnapshot({ rows: deterministic })
    expect(linear.reason).toBe('degenerate-innovations')
    expect(linear.value).toBeNull()
    expect(linear.unitRootTest).toBeNull()
  })

  it('validates explicit bounded parameters and reports warmup without zero-filled lines', () => {
    const rows = observations('stationary', { length: 80 })
    expect(buildStatisticalCenterSnapshot({ rows, lookback: 60, minObservations: 60 }).window.observations).toBe(60)
    expect(buildStatisticalCenterSnapshot({ rows, lookback: 15 }).status).toBe('invalid-parameters')
    expect(buildStatisticalCenterSnapshot({ rows, lookback: 1025 }).reason).toBe('invalid-lookback')
    expect(buildStatisticalCenterSnapshot({ rows, lookback: 60, minObservations: 61 }).reason).toBe(
      'invalid-minimum-observations',
    )
    const path = buildStatisticalCenterPath(rows)
    expect(path.slice(0, 59).every((point) => point.status === 'warming-up' && point.value === null)).toBe(true)
    expect(buildStatisticalCenterSnapshot({ rows: [] }).value).toBeNull()
    expect(buildStatisticalCenterSnapshot({ rows, observationIndex: 80 }).reason).toBe('invalid-observation-index')
  })
})
