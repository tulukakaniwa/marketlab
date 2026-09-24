import {
  CAUSAL_STATE_ASSUMPTIONS,
  CAUSAL_STATE_ASSUMPTION_NOTES,
  CAUSAL_STATE_MODEL_VERSION,
  assumptionSnapshot,
} from './causalStateAssumptions.js'
import {
  advanceCausalFilter,
  causalComponents,
  initializeCausalFilter,
  transitionWeights,
} from './causalStateFilter.js'

export { CAUSAL_STATE_ASSUMPTIONS, CAUSAL_STATE_MODEL_VERSION } from './causalStateAssumptions.js'

/**
 * O(n) forward filtering, O(1) learning state. For row t, score observations with
 * parameters through t-1, then update. The returned state is available at t:close
 * and describes next-session log-price dynamics, never an execution instruction.
 * No smoother, whole-sample fit, future-dependent window or wall clock is used.
 */
export function buildCausalStatePath(rows, { tradingDaysPerYear } = {}) {
  if (!Array.isArray(rows)) return []
  let filter = null
  let lastOrderedDate = null
  return Array.from(rows, (row, index) => {
    const reason = invalidReason(row, lastOrderedDate, tradingDaysPerYear)
    if (validDate(row?.date) && (lastOrderedDate === null || row.date > lastOrderedDate)) lastOrderedDate = row.date
    if (reason) {
      filter = null
      return invalidState(row, index, reason)
    }
    const logPrice = Math.log(row.close)
    const update = filter
      ? advanceCausalFilter(filter, logPrice, row.date)
      : { filter: initializeCausalFilter(logPrice, row.date), predictionAudit: initialPrediction(), assimilation: null }
    filter = update.filter
    const state = snapshot(filter, row, index, tradingDaysPerYear, update)
    if (!finiteSnapshot(state)) {
      filter = null
      return invalidState(row, index, 'numerical-domain-failure')
    }
    return state
  })
}

function snapshot(filter, row, index, tradingDaysPerYear, update) {
  const components = causalComponents(filter)
  const nextWeights = transitionWeights(filter.weights, filter.transitions)
  const nextMeans = components.map(
    (component) => component.driftPerSession + component.reversionRate * (filter.level - filter.logPrice),
  )
  const nextMeanReturn = nextMeans.reduce((sum, mean, i) => sum + nextWeights[i] * mean, 0)
  const nextVariance = components.reduce(
    (sum, component, i) => sum + nextWeights[i] * (component.variancePerSession + (nextMeans[i] - nextMeanReturn) ** 2),
    0,
  )
  return {
    ...stateMetadata(row, index),
    status: filter.sampleSize >= CAUSAL_STATE_ASSUMPTIONS.minimumContiguousObservations ? 'ready' : 'warming-up',
    sampleSize: filter.sampleSize,
    asOfDate: row.date,
    parametersThrough: row.date,
    availableAt: `${row.date}:close`,
    equilibrium: {
      price: Math.exp(filter.level),
      logPrice: filter.level,
      logVariance: filter.p00,
      driftPerSession: filter.drift,
    },
    volatility: {
      variancePerSession: filter.variance,
      innovationAnnualized: Math.sqrt(filter.variance * tradingDaysPerYear),
      annualized: Math.sqrt(nextVariance * tradingDaysPerYear),
      annualizedBasis: 'next-session-mixture-predictive-variance',
      nextSessionPredictiveVariance: nextVariance,
      varianceSource: 'ewma-one-step-mixture-innovation',
      forecastUncertainty: 'conditional-on-filtered-equilibrium-point',
    },
    dynamics: {
      components,
      transitionMatrix: filter.transitions.map((row) => [...row]),
      currentWeightSemantics: 'filtered-current-regime-model-weight',
      meanFormula: 'nextLogPrice = logPrice + driftPerSession + reversionRate * (equilibriumLogPrice - logPrice)',
    },
    predictionAudit: update.predictionAudit,
    assimilation: update.assimilation,
  }
}

function stateMetadata(row, index) {
  return {
    date: typeof row?.date === 'string' ? row.date : null,
    index,
    markPrice: Number.isFinite(row?.close) && row.close > 0 ? row.close : null,
    modelVersion: CAUSAL_STATE_MODEL_VERSION,
    futureRowsUsed: false,
    claimClass: 'model-estimate',
    executionAuthority: 'none',
    assumptions: [...CAUSAL_STATE_ASSUMPTION_NOTES],
    modelAssumptions: assumptionSnapshot(),
  }
}

function invalidState(row, index, reason) {
  return {
    ...stateMetadata(row, index),
    status: 'invalid-data',
    reason,
    sampleSize: 0,
    asOfDate: null,
    parametersThrough: null,
    availableAt: null,
    equilibrium: { price: null, logPrice: null, logVariance: null, driftPerSession: null },
    volatility: {
      variancePerSession: null,
      innovationAnnualized: null,
      annualized: null,
      nextSessionPredictiveVariance: null,
    },
    dynamics: { components: [], transitionMatrix: [] },
    predictionAudit: null,
    assimilation: null,
  }
}

function invalidReason(row, lastOrderedDate, tradingDaysPerYear) {
  if (!Number.isFinite(tradingDaysPerYear) || tradingDaysPerYear <= 0) return 'invalid-trading-days-per-year'
  if (!validDate(row?.date)) return 'invalid-session-date'
  if (lastOrderedDate !== null && row.date <= lastOrderedDate) return 'non-increasing-session-date'
  if (row.isClosed === false || row.closed === false) return 'unclosed-session'
  if (!Number.isFinite(row.close) || row.close <= 0) return 'invalid-close-price'
  const supplied = ['open', 'high', 'low'].filter((key) => row[key] !== undefined)
  if (supplied.some((key) => !Number.isFinite(row[key]) || row[key] <= 0)) return 'invalid-ohlc-price'
  if (row.high !== undefined && row.high < Math.max(row.close, row.open ?? row.close)) return 'inconsistent-ohlc-range'
  if (row.low !== undefined && row.low > Math.min(row.close, row.open ?? row.close)) return 'inconsistent-ohlc-range'
  if (row.volume !== undefined && (!Number.isFinite(row.volume) || row.volume < 0)) return 'invalid-volume'
  return null
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

function initialPrediction() {
  return {
    status: 'segment-initialization-no-predictive-density',
    parametersThrough: null,
    availableAt: null,
    sampleSize: 0,
    componentPredictions: [],
    futureRowsUsed: false,
  }
}

function finiteSnapshot(state) {
  return (
    [
      ...Object.values(state.equilibrium),
      state.volatility.variancePerSession,
      state.volatility.innovationAnnualized,
      state.volatility.annualized,
      state.volatility.nextSessionPredictiveVariance,
      ...state.dynamics.transitionMatrix.flat(),
      ...state.dynamics.components.flatMap(({ weight, driftPerSession, reversionRate, variancePerSession }) => [
        weight,
        driftPerSession,
        reversionRate,
        variancePerSession,
      ]),
    ].every(Number.isFinite) && state.equilibrium.price > 0
  )
}
