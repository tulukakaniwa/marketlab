import { buildCausalStatePath } from './causalStatePath.js'
import { solveFirstPassage } from './firstPassage.js'

export const CAUSAL_MODEL_VERSION = 'causal-core-v1'
export const CAUSAL_QUERY_LIMITS = Object.freeze({ gridSize: 61, maxSessions: 128 })

const QUERY_ASSUMPTIONS = [
  'closed-session-inputs-only',
  'filtered-equilibrium-is-not-observed-position-cost',
  'target-is-current-filtered-equilibrium',
  'risk-boundary-is-equal-opposite-log-distance-from-current-price',
  'query-window-is-one-current-diffusion-timescale-not-a-holding-recommendation',
  'transition-parameters-and-equilibrium-frozen-at-observation',
  'first-passage-observed-at-session-closes-not-intraday',
  'model-probabilities-not-empirically-calibrated-win-rates',
]

/**
 * A separate, prefix-only research query. No planning inputs, future IV, manual
 * horizon, fitted full-sample parameters, or future target are accepted.
 * An explicit observationIndex also makes the public API safe for cursor use.
 */
export function buildCausalModelSnapshot({ rows, tradingDaysPerYear, observationIndex = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return emptySnapshot('warming-up', 'missing-history')
  const index = observationIndex === null ? rows.length - 1 : observationIndex
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    return emptySnapshot('invalid-data', 'invalid-observation-index')
  }
  if (!Number.isFinite(tradingDaysPerYear) || tradingDaysPerYear <= 0) {
    return emptySnapshot('invalid-data', 'missing-trading-days-per-year')
  }
  const visibleRows = rows.slice(0, index + 1)
  const statePath = buildCausalStatePath(visibleRows, { tradingDaysPerYear })
  const state = statePath.at(-1)
  if (!state) return emptySnapshot('warming-up', 'missing-state')
  return {
    modelVersion: CAUSAL_MODEL_VERSION,
    source: 'causal-prefix-model',
    status: state.status,
    asOfDate: state.asOfDate ?? state.date,
    availableAt: state.availableAt ?? null,
    observationIndex: index,
    visibleRows: visibleRows.length,
    parametersThrough: state.parametersThrough,
    futureRowsUsed: false,
    claimClass: 'model-estimate',
    executionAuthority: 'none',
    state,
    // Reuse the forward filter; no historical passage solves or current-state backfill.
    chartPath: statePath.map((point) => ({
      date: point.date,
      status: point.status,
      equilibriumPrice: point.status === 'ready' ? point.equilibrium.price : null,
      availableAt: point.availableAt ?? null,
      executionAuthority: 'none',
    })),
    passage: state.status === 'ready' ? queryCausalPassage(state) : unavailablePassage('state-not-ready'),
    assumptions: [...(state.assumptions ?? []), ...QUERY_ASSUMPTIONS],
  }
}

/** Derive all query boundaries and its time scale from the current state. */
export function deriveCausalPassageQuery(state) {
  const markPrice = state?.markPrice
  const anchorPrice = state?.equilibrium?.price
  if (state?.status !== 'ready') return unavailablePassage('state-not-ready')
  if (![markPrice, anchorPrice].every((value) => Number.isFinite(value) && value > 0)) {
    return unavailablePassage('invalid-equilibrium')
  }
  const logPrice = Math.log(markPrice)
  const logAnchor = Math.log(anchorPrice)
  const logGap = logAnchor - logPrice
  // This is a floating-point indistinguishability tolerance, not an entry gate.
  if (Math.abs(logGap) <= 1e-12) return unavailablePassage('at-equilibrium')
  const components = state?.dynamics?.components ?? []
  if (
    !Array.isArray(components) ||
    components.length === 0 ||
    components.some(
      (component) =>
        !component ||
        !Number.isFinite(component.weight) ||
        component.weight < 0 ||
        !Number.isFinite(component.variancePerSession) ||
        component.variancePerSession < 0,
    )
  ) {
    return unavailablePassage('invalid-model-components')
  }
  const activeWeight = components.reduce((sum, component) => sum + component.weight, 0)
  if (!(activeWeight > 0) || !Number.isFinite(activeWeight) || Math.abs(activeWeight - 1) > 1e-8) {
    return unavailablePassage('invalid-model-weights')
  }
  const matrix = state?.dynamics?.transitionMatrix
  if (
    !Array.isArray(matrix) ||
    matrix.length !== components.length ||
    matrix.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== components.length ||
        row.some((value) => !Number.isFinite(value) || value < 0) ||
        Math.abs(row.reduce((sum, value) => sum + value, 0) - 1) > 1e-8,
    )
  ) {
    return unavailablePassage('invalid-transition-matrix')
  }
  const nextWeights = components.map((_, destination) =>
    components.reduce((sum, component, source) => sum + component.weight * matrix[source][destination], 0),
  )
  const weightedVariance = components.reduce(
    (sum, component, index) => sum + nextWeights[index] * component.variancePerSession,
    0,
  )
  if (!(weightedVariance > 0) || !Number.isFinite(weightedVariance)) {
    return unavailablePassage('degenerate-diffusion-scale')
  }
  const diffusionScaleSessions = (logGap * logGap) / weightedVariance
  const horizonSessions = Math.max(1, Math.ceil(diffusionScaleSessions))
  if (!Number.isSafeInteger(horizonSessions)) return unavailablePassage('diffusion-window-out-of-numerical-range')
  const riskPrice = Math.exp(logPrice - logGap)
  if (!Number.isFinite(riskPrice) || riskPrice <= 0) return unavailablePassage('invalid-risk-boundary')
  return {
    status: 'ready',
    side: logGap > 0 ? 'long' : 'short',
    markPrice,
    targetPrice: anchorPrice,
    riskPrice,
    lowerPrice: Math.min(anchorPrice, riskPrice),
    upperPrice: Math.max(anchorPrice, riskPrice),
    horizonSessions,
    diffusionScaleSessions,
    windowBasis: 'squared-log-anchor-gap-over-next-regime-mixture-innovation-variance',
    boundaryBasis: 'current-equilibrium-with-symmetric-log-risk-boundary',
    boundaryAuthority: 'research-query-only',
    equilibriumUncertaintyIncludedInPassage: false,
    futureRowsUsed: false,
  }
}

export function queryCausalPassage(state) {
  const query = deriveCausalPassageQuery(state)
  if (query.status !== 'ready') return query
  const result = solveFirstPassage({ state, ...query, ...CAUSAL_QUERY_LIMITS })
  if (result.status !== 'ready') return { ...query, ...result }
  const targetSide = query.side === 'long' ? 'upper' : 'lower'
  const riskSide = query.side === 'long' ? 'lower' : 'upper'
  return {
    ...query,
    ...result,
    targetProbability: result[`${targetSide}Probability`],
    riskProbability: result[`${riskSide}Probability`],
    conditionalMedianSessions: {
      ...result.conditionalMedianSessions,
      target: result.conditionalMedianSessions?.[targetSide] ?? null,
      risk: result.conditionalMedianSessions?.[riskSide] ?? null,
    },
    targetSide,
    riskSide,
    executionAuthority: 'none',
    claimClass: 'conditional-model-estimate',
  }
}

function unavailablePassage(reason) {
  return { status: 'unavailable', reason, executionAuthority: 'none' }
}

function emptySnapshot(status, reason) {
  return {
    modelVersion: CAUSAL_MODEL_VERSION,
    source: 'causal-prefix-model',
    status,
    reason,
    asOfDate: null,
    availableAt: null,
    state: null,
    chartPath: [],
    passage: unavailablePassage(reason),
    futureRowsUsed: false,
    claimClass: 'model-estimate',
    executionAuthority: 'none',
    assumptions: [...QUERY_ASSUMPTIONS],
  }
}
