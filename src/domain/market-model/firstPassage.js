import {
  gaussianCellKernel,
  MASS_TOLERANCE,
  NORMAL_CDF_ERROR_BOUND,
  normalizeProbabilityVector,
  sumMass,
  transitionWeights,
} from './firstPassageNumerics.js'

export const FIRST_PASSAGE_LIMITS = Object.freeze({ maxGridSize: 121, maxSessions: 256, maxComponents: 8 })

/**
 * Absorbing finite-volume Markov query at session closes, conditional on an
 * as-of snapshot. Transition i -> j precedes destination j's price kernel.
 * Complexity: O(R*G^2 + H*(R^2*G + R*G^2)); memory O(R*G^2).
 * No history, future observations, stochastic simulation or browser APIs.
 */
export function solveFirstPassage({
  state,
  lowerPrice,
  upperPrice,
  horizonSessions,
  gridSize = 61,
  maxSessions = 128,
} = {}) {
  const base = emptyResult(horizonSessions)
  if (state?.status !== 'ready') return failure(base, 'missing-input', 'model-state-not-ready')
  const query = validateQuery({ state, lowerPrice, upperPrice, horizonSessions, gridSize, maxSessions })
  if (query.reason) return failure(base, 'invalid-input', query.reason)
  const { components, weights, matrix, anchor, lower, upper, corrections } = query
  const horizon = Math.min(horizonSessions, maxSessions)
  const cellWidth = (upper - lower) / gridSize
  const sigmaToCellWidth = components.map((component) => Math.sqrt(component.variancePerSession) / cellWidth)
  const result = {
    ...base,
    status: 'ready',
    computedHorizonSessions: horizon,
    truncated: horizon < horizonSessions,
    numerical: {
      method: 'absorbing-gaussian-cell-integration',
      firstStep: 'exact-current-price-gaussian-integration',
      gridSize,
      logCellWidth: cellWidth,
      componentCount: components.length,
      limits: FIRST_PASSAGE_LIMITS,
      maxSessions,
      complexity: 'O(R*G^2 + H*(R^2*G + R*G^2))',
      gaussianCdfAbsoluteErrorBound: NORMAL_CDF_ERROR_BOUND,
      tailPolicy: 'both-unbounded-tails-absorbed-without-survivor-renormalization',
      massTolerance: MASS_TOLERANCE,
      maximumMassDrift: 0,
      maximumToleranceCorrection: corrections,
      gridApproximation: 'interior-cell-mass-represented-at-cell-midpoint-after-first-step',
      minimumSigmaToCellWidth: Math.min(...sigmaToCellWidth),
      resolutionStatus: sigmaToCellWidth.some((ratio) => ratio < 1)
        ? 'coarse-relative-to-transition-scale'
        : 'resolved-transition-scale',
    },
  }
  if (state.markPrice <= lowerPrice || state.markPrice >= upperPrice) {
    result.numerical.method = 'already-at-absorbing-boundary'
    const lowerHit = state.markPrice <= lowerPrice ? 1 : 0
    return finish(result, [
      {
        session: 0,
        lower: lowerHit,
        upper: 1 - lowerHit,
        survival: 0,
        lowerCumulative: lowerHit,
        upperCumulative: 1 - lowerHit,
      },
    ])
  }
  const identicalDeterministic = components.every(
    (component) =>
      component.variancePerSession === 0 &&
      component.driftPerSession === components[0].driftPerSession &&
      component.reversionRate === components[0].reversionRate,
  )
  if (identicalDeterministic)
    return solveDeterministic(result, { component: components[0], anchor, lower, upper, horizon })

  const edges = Array.from({ length: gridSize + 1 }, (_, index) => lower + (index / gridSize) * (upper - lower))
  edges[gridSize] = upper
  const centers = edges.slice(0, -1).map((edge, index) => (edge + edges[index + 1]) / 2)
  const kernels = components.map((component) =>
    centers.map((price) => makeKernel(price, component, anchor, edges, result)),
  )
  const initialKernels = components.map((component) => makeKernel(0, component, anchor, edges, result))
  if (kernels.some((row) => row.some((kernel) => !kernel)) || initialKernels.some((kernel) => !kernel)) {
    return failure(result, 'numerical-failure', 'non-finite-transition-kernel')
  }

  const distribution = []
  let mass = components.map(() => new Float64Array(gridSize))
  let lowerCumulative = 0
  let upperCumulative = 0
  for (let session = 1; session <= horizon; session += 1) {
    const next = components.map(() => new Float64Array(gridSize))
    const absorbed = { lower: 0, upper: 0 }
    if (session === 1) {
      const nextWeights = transitionWeights(weights, matrix)
      nextWeights.forEach((weight, regime) => allocate(weight, initialKernels[regime], next[regime], absorbed))
    } else {
      for (let regime = 0; regime < components.length; regime += 1) {
        for (let cell = 0; cell < gridSize; cell += 1) {
          let mixedMass = 0
          for (let source = 0; source < components.length; source += 1)
            mixedMass += mass[source][cell] * matrix[source][regime]
          if (mixedMass > 0) allocate(mixedMass, kernels[regime][cell], next[regime], absorbed)
        }
      }
    }
    mass = next
    lowerCumulative += absorbed.lower
    upperCumulative += absorbed.upper
    const survival = sumMass(mass)
    const drift = Math.abs(lowerCumulative + upperCumulative + survival - 1)
    result.numerical.maximumMassDrift = Math.max(result.numerical.maximumMassDrift, drift)
    if (!Number.isFinite(drift) || drift > MASS_TOLERANCE)
      return failure(result, 'numerical-failure', 'probability-mass-drift')
    distribution.push({ session, ...absorbed, survival, lowerCumulative, upperCumulative })
  }
  return finish(result, distribution)
}

function validateQuery({ state, lowerPrice, upperPrice, horizonSessions, gridSize, maxSessions }) {
  if (
    ![state.markPrice, lowerPrice, upperPrice].every((price) => Number.isFinite(price) && price > 0) ||
    lowerPrice >= upperPrice
  ) {
    return { reason: 'invalid-price-boundaries' }
  }
  if (!Number.isFinite(state.equilibrium?.logPrice)) return { reason: 'invalid-equilibrium' }
  if (!Number.isSafeInteger(horizonSessions) || horizonSessions < 1) return { reason: 'invalid-horizon-sessions' }
  if (!Number.isInteger(gridSize) || gridSize < 3 || gridSize > FIRST_PASSAGE_LIMITS.maxGridSize)
    return { reason: 'grid-size-out-of-bounds' }
  if (!Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > FIRST_PASSAGE_LIMITS.maxSessions)
    return { reason: 'session-limit-out-of-bounds' }
  const components = state.dynamics?.components
  if (!Array.isArray(components) || components.length < 1 || components.length > FIRST_PASSAGE_LIMITS.maxComponents)
    return { reason: 'component-count-out-of-bounds' }
  if (
    components.some(
      (component) =>
        !component ||
        ![component.driftPerSession, component.reversionRate, component.variancePerSession].every(Number.isFinite) ||
        component.variancePerSession < 0,
    )
  )
    return { reason: 'invalid-dynamics-parameters' }
  const weights = normalizeProbabilityVector(components.map((component) => component.weight))
  const inputMatrix = state.dynamics.transitionMatrix
  if (!weights || !Array.isArray(inputMatrix) || inputMatrix.length !== components.length)
    return { reason: 'invalid-regime-probabilities' }
  const matrix = inputMatrix.map((row) => (row?.length === components.length ? normalizeProbabilityVector(row) : null))
  if (matrix.some((row) => !row)) return { reason: 'invalid-transition-matrix' }
  const lower = logRatio(lowerPrice, state.markPrice)
  const upper = logRatio(upperPrice, state.markPrice)
  const anchor = state.equilibrium.logPrice - Math.log(state.markPrice)
  if (
    ![lower, upper, anchor].every(Number.isFinite) ||
    upper - lower <= Number.EPSILON * Math.max(1, Math.abs(lower), Math.abs(upper)) * gridSize
  )
    return { reason: 'unresolvable-log-price-grid' }
  return {
    components,
    weights: weights.values,
    matrix: matrix.map((row) => row.values),
    anchor,
    lower,
    upper,
    corrections: Math.max(Math.abs(weights.correction), ...matrix.map((row) => Math.abs(row.correction))),
  }
}

function nextMean(price, component, anchor) {
  return price + component.driftPerSession + component.reversionRate * (anchor - price)
}

function makeKernel(price, component, anchor, edges, result) {
  const kernel = gaussianCellKernel({
    mean: nextMean(price, component, anchor),
    variance: component.variancePerSession,
    edges,
  })
  if (!kernel) return null
  result.numerical.maximumToleranceCorrection = Math.max(
    result.numerical.maximumToleranceCorrection,
    Math.abs(kernel.correction),
  )
  return kernel.probabilities
}

function allocate(weight, probabilities, mass, absorbed) {
  absorbed.lower += weight * probabilities[0]
  absorbed.upper += weight * probabilities[probabilities.length - 1]
  for (let index = 0; index < mass.length; index += 1) mass[index] += weight * probabilities[index + 1]
}

function solveDeterministic(result, { component, anchor, lower, upper, horizon }) {
  result.numerical.method = 'exact-deterministic-session-recursion'
  result.numerical.gridApproximation = 'none'
  result.numerical.resolutionStatus = 'exact-deterministic-recursion'
  const distribution = []
  let price = 0
  let survival = 1
  let lowerCumulative = 0
  let upperCumulative = 0
  for (let session = 1; session <= horizon; session += 1) {
    if (survival) price = nextMean(price, component, anchor)
    if (!Number.isFinite(price)) return failure(result, 'numerical-failure', 'non-finite-deterministic-transition')
    const lowerHit = survival && price <= lower ? 1 : 0
    const upperHit = survival && price >= upper ? 1 : 0
    lowerCumulative += lowerHit
    upperCumulative += upperHit
    survival -= lowerHit + upperHit
    distribution.push({ session, lower: lowerHit, upper: upperHit, survival, lowerCumulative, upperCumulative })
  }
  return finish(result, distribution)
}

function finish(result, distribution) {
  const final = distribution.at(-1)
  return {
    ...result,
    lowerProbability: final.lowerCumulative,
    upperProbability: final.upperCumulative,
    survivalProbability: final.survival,
    distribution,
    conditionalMedianSessions: {
      lower: conditionalMedian(distribution, 'lowerCumulative', final.lowerCumulative),
      upper: conditionalMedian(distribution, 'upperCumulative', final.upperCumulative),
    },
  }
}

function conditionalMedian(distribution, field, probability) {
  if (probability <= 0) return null
  return distribution.find((row) => row[field] >= probability / 2)?.session ?? null
}

function emptyResult(horizon) {
  return {
    status: 'missing-input',
    lowerProbability: null,
    upperProbability: null,
    survivalProbability: null,
    distribution: [],
    conditionalMedianSessions: { lower: null, upper: null },
    conditionalMedianBasis: 'conditional-on-side-hit-within-computed-horizon',
    quantileCondition: 'hit-respective-boundary-within-computed-horizon',
    requestedHorizonSessions: horizon ?? null,
    computedHorizonSessions: 0,
    truncated: false,
    observationMode: 'session-close',
    parameterEvolution: 'frozen-at-observation',
    claimClass: 'conditional-model-probability',
    numerical: null,
  }
}

function failure(result, status, reason) {
  return { ...result, status, reason }
}

function logRatio(price, reference) {
  const ratio = price / reference
  return Number.isFinite(ratio) && ratio > 0 ? Math.log(ratio) : Math.log(price) - Math.log(reference)
}
