export const STATISTICAL_CENTER_VERSION = 'statistical-log-ar1-df-lb.v2'
export const STATISTICAL_CENTER_DEFAULTS = Object.freeze({ lookback: 120, minObservations: 60 })
export const STATISTICAL_CENTER_LIMITS = Object.freeze({ minimumObservations: 20, maximumLookback: 1024 })

// MacKinnon (2010), N=1, constant/no trend: c0+c1/n+c2/n²+c3/n³.
// Primary implementation: statsmodels/tsa/adfvalues.py, tau_c_2010[0].
// https://github.com/statsmodels/statsmodels/blob/v0.14.4/statsmodels/tsa/adfvalues.py
const CRITICAL_COEFFICIENTS = {
  '1%': [-3.43035, -6.5393, -16.786, -79.433],
  '5%': [-2.86154, -2.8903, -4.234, -40.04],
  '10%': [-2.56677, -1.5384, -2.809, 0],
}
// Fixed diagnostic, not a searched lag/threshold: chi2.ppf(0.95, 5 - AR_order_1).
const RESIDUAL_LAGS = 5
const RESIDUAL_CRITICAL_VALUE = 9.487729036781154
const ASSUMPTIONS = Object.freeze([
  'Closed rows are successive trading sessions; calendar gaps are not elapsed sessions.',
  'A missing, invalid or explicitly unclosed observation breaks the contiguous estimation window.',
  'An optional availability token must be known by its own session close; absence relies on the closed-row input contract.',
  'The window fits log(close) = intercept + phi * previous log(close) + innovation, with a constant and no trend.',
  'Dickey-Fuller lag 0 assumes uncorrelated, homoskedastic finite-variance innovations; no lag selection or whitening is performed.',
  'A fixed lag-5 Ljung-Box residual test rejects serial correlation at 5%, with one AR parameter consuming a degree of freedom.',
  'Not rejecting that residual test does not prove independent, homoskedastic innovations, parameter stability or a correct model.',
  'The constant AR(1) parameters and innovation distribution are assumed stable within the declared window.',
  'Rejecting a unit root supports this statistical specification; it does not prove stationarity, economic restoring forces or calibrated trading probabilities.',
  'Failure to reject a unit root does not establish a unit root or distinguish a stochastic trend from deterministic trend.',
  'The center price is exp(fitted stationary log mean), not expected arithmetic price, observed investor cost or supply-demand equilibrium.',
  'The half life concerns a conditional mean-deviation envelope, not a noisy first-passage time.',
  'Reported center uncertainty is conditional delta-method coefficient uncertainty; model selection, breaks and window choice are excluded.',
])

/** Fixed-window, forward-only AR(1) identification. Each point owns its historical fit. */
export function buildStatisticalCenterPath(rows, options = {}) {
  if (!Array.isArray(rows)) return []
  const parameters = checkedParameters(options)
  const window = []
  let lastOrderedDate = null
  return Array.from(rows, (row, index) => {
    const reason = rowReason(row, lastOrderedDate)
    if (validDate(row?.date) && (lastOrderedDate === null || row.date > lastOrderedDate)) lastOrderedDate = row.date
    if (reason) window.length = 0
    else {
      window.push({ date: row.date, close: row.close, index })
      if (window.length > (parameters.reason ? 0 : parameters.lookback)) window.shift()
    }
    return estimate(window, row, index, parameters, reason)
  })
}

/** Only rows 0..observationIndex are read, including their closure and validation flags. */
export function buildStatisticalCenterSnapshot({ rows, observationIndex = null, ...options } = {}) {
  const parameters = checkedParameters(options)
  if (!Array.isArray(rows) || !rows.length) return empty(null, null, parameters, 'warming-up', 'missing-history')
  const index = observationIndex === null ? rows.length - 1 : observationIndex
  if (!Number.isInteger(index) || index < 0 || index >= rows.length)
    return empty(null, null, parameters, 'invalid-data', 'invalid-observation-index')
  const window = []
  let lastOrderedDate = null,
    reason = null,
    row
  for (let cursor = 0; cursor <= index; cursor++) {
    row = rows[cursor]
    reason = rowReason(row, lastOrderedDate)
    if (validDate(row?.date) && (lastOrderedDate === null || row.date > lastOrderedDate)) lastOrderedDate = row.date
    if (reason) window.length = 0
    else {
      window.push({ date: row.date, close: row.close, index: cursor })
      if (window.length > (parameters.reason ? 0 : parameters.lookback)) window.shift()
    }
  }
  return estimate(window, row, index, parameters, reason)
}

function estimate(window, row, index, parameters, invalidReason) {
  const base = empty(row, index, parameters, 'unidentified', null)
  base.window = {
    startDate: window[0]?.date ?? null,
    endDate: window.at(-1)?.date ?? null,
    startIndex: window[0]?.index ?? null,
    observations: window.length,
    regressionObservations: Math.max(0, window.length - 1),
  }
  if (parameters.reason) return { ...base, status: 'invalid-parameters', reason: parameters.reason }
  if (invalidReason) return { ...base, status: 'invalid-data', reason: invalidReason, availableAt: null }
  if (window.length < parameters.minObservations)
    return { ...base, status: 'warming-up', reason: 'insufficient-contiguous-observations' }

  // Fit relative log prices to avoid cancellation from currency/price-unit shifts.
  const reference = Math.log(window[0].close)
  const prices = window.map((point) => Math.log(point.close) - reference)
  const x = prices.slice(0, -1)
  const changes = x.map((value, cursor) => prices[cursor + 1] - value)
  const n = x.length
  const meanX = mean(x),
    meanChange = mean(changes)
  const xx = x.reduce((sum, value) => sum + (value - meanX) ** 2, 0)
  const roundoff = (64 * Number.EPSILON) ** 2
  if (!(xx > roundoff * n)) return { ...base, reason: 'degenerate-price-window' }
  const delta = x.reduce((sum, value, cursor) => sum + (value - meanX) * (changes[cursor] - meanChange), 0) / xx
  const alpha = meanChange - delta * meanX
  const phi = 1 + delta
  const residuals = x.map((value, cursor) => changes[cursor] - alpha - delta * value)
  const sse = residuals.reduce((sum, value) => sum + value ** 2, 0)
  const innovationVariance = sse / (n - 2)
  const coefficientStandardError = Math.sqrt(innovationVariance / xx)
  const current = prices.at(-1)
  base.autoregression = {
    phi,
    delta,
    reversionRate: -delta,
    intercept: alpha - delta * reference,
    innovationVariance,
    coefficientStandardError,
    degreesOfFreedom: n - 2,
    expectedNextLogReturn: alpha + delta * current,
    residualLag1Correlation: residualCorrelation(residuals),
    fitMethod: 'ordinary-least-squares-with-intercept',
  }
  if (![delta, alpha, innovationVariance, coefficientStandardError].every(Number.isFinite))
    return { ...base, status: 'numerical-failure', reason: 'non-finite-autoregression' }
  // Zero innovations do not support the stochastic Dickey-Fuller reference law.
  if (!(innovationVariance > roundoff)) return { ...base, reason: 'degenerate-innovations' }

  const criticalValues = criticalValuesAt(n)
  const statistic = delta / coefficientStandardError
  base.unitRootTest = {
    method: 'Dickey-Fuller',
    lags: 0,
    regression: 'constant-no-trend',
    nullHypothesis: 'unit-root-phi-equals-one',
    alternative: 'stationary-around-constant',
    statistic,
    significance: 0.05,
    criticalValues,
    rejectNull: statistic < criticalValues['5%'],
    pValue: null,
    pValueReason: 'not-computed',
    criticalValueBasis: 'MacKinnon-2010-N1-finite-sample-response-surface',
    source: 'https://github.com/statsmodels/statsmodels/blob/v0.14.4/statsmodels/tsa/adfvalues.py',
  }
  base.residualTest = residualTest(residuals)
  if (!(Math.abs(phi) < 1)) return { ...base, reason: 'nonstationary-ar-coefficient' }
  if (!base.unitRootTest.rejectNull) return { ...base, reason: 'unit-root-not-rejected' }
  if (base.residualTest.rejectNull) return { ...base, reason: 'residual-autocorrelation-rejected' }
  const logPrice = reference - alpha / delta
  const price = Math.exp(logPrice)
  const halfLife = phi === 0 ? 0 : Math.log(0.5) / Math.log(Math.abs(phi))
  const centerVariance =
    innovationVariance / (n * delta ** 2) + (innovationVariance / xx) * (meanChange / delta ** 2) ** 2
  if (![logPrice, price, halfLife, centerVariance].every(Number.isFinite) || !(price > 0))
    return { ...base, status: 'numerical-failure', reason: 'non-finite-center' }
  return {
    ...base,
    status: 'ready',
    reason: null,
    value: price,
    center: { price, logPrice, priceStatistic: 'exp-of-fitted-stationary-log-mean' },
    halfLifeSessions: halfLife,
    response: phi < 0 ? 'oscillating-decay' : phi === 0 ? 'immediate-decay' : 'monotone-decay',
    uncertainty: {
      method: 'conditional-ar1-delta-method',
      centerLogStandardError: Math.sqrt(centerVariance),
      includesModelSelectionUncertainty: false,
      includesStructuralBreakUncertainty: false,
      includesWindowChoiceUncertainty: false,
    },
  }
}

function empty(row, index, parameters, status, reason) {
  return {
    modelVersion: STATISTICAL_CENTER_VERSION,
    source: 'statistical-center-prefix',
    fitObject: 'constant-mean-log-price-ar1',
    status,
    reason,
    date: typeof row?.date === 'string' ? row.date : null,
    asOfDate: typeof row?.date === 'string' ? row.date : null,
    observationIndex: index,
    availableAt: validDate(row?.date) ? `${row.date}:close` : null,
    futureRowsUsed: false,
    claimClass: 'conditional-model-estimate',
    executionAuthority: 'none',
    parameters: {
      lookback: parameters.lookback,
      minObservations: parameters.minObservations,
      lags: 0,
      significance: 0.05,
      residualLags: RESIDUAL_LAGS,
    },
    assumptions: [...ASSUMPTIONS],
    value: null,
    center: { price: null, logPrice: null, priceStatistic: 'exp-of-fitted-stationary-log-mean' },
    halfLifeSessions: null,
    response: null,
    autoregression: null,
    unitRootTest: null,
    residualTest: null,
    uncertainty: null,
  }
}

function checkedParameters({
  lookback = STATISTICAL_CENTER_DEFAULTS.lookback,
  minObservations = STATISTICAL_CENTER_DEFAULTS.minObservations,
} = {}) {
  const reason =
    !Number.isInteger(lookback) ||
    lookback < STATISTICAL_CENTER_LIMITS.minimumObservations ||
    lookback > STATISTICAL_CENTER_LIMITS.maximumLookback
      ? 'invalid-lookback'
      : !Number.isInteger(minObservations) ||
          minObservations < STATISTICAL_CENTER_LIMITS.minimumObservations ||
          minObservations > lookback
        ? 'invalid-minimum-observations'
        : null
  return { lookback, minObservations, reason }
}

function rowReason(row, previousDate) {
  if (!validDate(row?.date)) return 'invalid-session-date'
  if (previousDate !== null && row.date <= previousDate) return 'non-increasing-session-date'
  if (row.closed === false || row.isClosed === false) return 'unclosed-session'
  if (
    row.availableAt !== undefined &&
    !(
      typeof row.availableAt === 'string' &&
      row.availableAt === `${row.availableAt.slice(0, 10)}:close` &&
      validDate(row.availableAt.slice(0, 10)) &&
      row.availableAt.slice(0, 10) <= row.date
    )
  )
    return 'bar-not-available-at-close'
  if (!Number.isFinite(row.close) || row.close <= 0) return 'invalid-close-price'
  return null
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const stamp = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value
}
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}
function criticalValuesAt(n) {
  return Object.fromEntries(
    Object.entries(CRITICAL_COEFFICIENTS).map(([level, [c0, c1, c2, c3]]) => [
      level,
      c0 + c1 / n + c2 / n ** 2 + c3 / n ** 3,
    ]),
  )
}
function residualCorrelation(values) {
  const total = values.reduce((sum, value) => sum + value ** 2, 0)
  return total > 0 ? values.slice(1).reduce((sum, value, index) => sum + value * values[index], 0) / total : null
}

function residualTest(values) {
  // statsmodels acorr_ljungbox demeans and uses the biased, common-denominator ACF.
  const residualMean = mean(values)
  const centered = values.map((value) => value - residualMean)
  const denominator = centered.reduce((sum, value) => sum + value ** 2, 0)
  const n = centered.length
  const autocorrelations = Array.from({ length: RESIDUAL_LAGS }, (_, index) => {
    const lag = index + 1
    const numerator = centered.slice(lag).reduce((sum, value, cursor) => sum + value * centered[cursor], 0)
    return numerator / denominator
  })
  const statistic =
    n * (n + 2) * autocorrelations.reduce((sum, correlation, index) => sum + correlation ** 2 / (n - index - 1), 0)
  // Exact chi-square(4) survival law, used as the test's asymptotic reference.
  const pValue = Math.exp(-statistic / 2) * (1 + statistic / 2)
  return {
    method: 'Ljung-Box',
    role: 'assumption-gate',
    lags: RESIDUAL_LAGS,
    modelDegreesOfFreedom: 1,
    degreesOfFreedom: 4,
    nullHypothesis: 'no-residual-autocorrelation-through-lag-5',
    statistic,
    pValue,
    significance: 0.05,
    criticalValue: RESIDUAL_CRITICAL_VALUE,
    referenceDistribution: 'asymptotic-chi-square',
    rejectNull: statistic > RESIDUAL_CRITICAL_VALUE,
    autocorrelations,
    source: 'https://www.statsmodels.org/stable/generated/statsmodels.stats.diagnostic.acorr_ljungbox.html',
    nonRejectionMeaning: 'serial-correlation-not-detected-at-these-lags-not-proof-of-iid',
  }
}
