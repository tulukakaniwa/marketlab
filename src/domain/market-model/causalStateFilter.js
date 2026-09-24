import { CAUSAL_STATE_ASSUMPTIONS as A } from './causalStateAssumptions.js'

const REGIME_IDS = ['reversion', 'trend', 'shock']

export function initializeCausalFilter(logPrice, date) {
  return {
    date,
    logPrice,
    sampleSize: 1,
    level: logPrice,
    drift: 0,
    p00: A.initialVariancePerSession * A.initialLevelVarianceRatio,
    p01: 0,
    p11: A.initialVariancePerSession * A.initialDriftVarianceRatio,
    variance: A.initialVariancePerSession,
    weights: [...A.initialRegimeWeights],
    transitions: A.initialTransitionMatrix.map((row) => [...row]),
    transitionEvidence: zeroMatrix(),
    reversionXX: 0,
    reversionXY: 0,
    trendReturnSum: 0,
    trendWeight: 0,
    reversionRate: A.initialReversionRate,
    trendDrift: 0,
  }
}

export function causalComponents(filter) {
  return REGIME_IDS.map((id, index) => {
    const reversionRate = id === 'reversion' ? filter.reversionRate : 0
    return {
      id,
      weight: filter.weights[index],
      driftPerSession: id === 'trend' ? filter.trendDrift : 0,
      reversionRate,
      // A plug-in transition kernel conditions on the filtered level estimate.
      // Its uncertainty is not an independent fresh shock at every future step.
      variancePerSession: filter.variance * (id === 'shock' ? A.shockVarianceMultiplier : 1),
    }
  })
}

export function advanceCausalFilter(previous, logPrice, date) {
  const components = causalComponents(previous)
  const predictedWeights = transitionWeights(previous.weights, previous.transitions)
  const predictions = components.map((component, index) => ({
    id: component.id,
    weight: predictedWeights[index],
    logMean:
      previous.logPrice + component.driftPerSession + component.reversionRate * (previous.level - previous.logPrice),
    variancePerSession: component.variancePerSession,
  }))
  const logLikelihoods = predictions.map((prediction) => normalLogDensity(logPrice, prediction))
  const weights = posteriorWeights(predictedWeights, logLikelihoods)
  const kalman = advanceKalman(previous, logPrice)
  const logReturn = logPrice - previous.logPrice
  const expectedReturn = predictions.reduce(
    (sum, prediction) => sum + prediction.weight * (prediction.logMean - previous.logPrice),
    0,
  )
  const innovation = logReturn - expectedReturn
  const variance = Math.max(
    A.varianceFloor,
    (1 - A.varianceLearningRate) * previous.variance + A.varianceLearningRate * innovation ** 2,
  )
  const parameters = updateExpertParameters(previous, weights, logReturn)
  const transitionEvidence = updateTransitionEvidence(previous, predictedWeights, weights)
  const transitions = transitionEvidence.map((row, i) =>
    normalize(row.map((value, j) => value + A.transitionPriorMassPerRow * A.initialTransitionMatrix[i][j])),
  )

  return {
    filter: {
      ...previous,
      ...kalman.posterior,
      ...parameters,
      date,
      logPrice,
      sampleSize: previous.sampleSize + 1,
      weights,
      transitions,
      transitionEvidence,
      variance,
    },
    predictionAudit: {
      status: 'previous-session-prediction',
      parametersThrough: previous.date,
      availableAt: `${previous.date}:close`,
      sampleSize: previous.sampleSize,
      equilibriumLogPrice: previous.level,
      innovationVariancePerSession: previous.variance,
      componentPredictions: predictions,
      transitionMatrix: previous.transitions.map((row) => [...row]),
      kalman: kalman.prediction,
      futureRowsUsed: false,
    },
    assimilation: { logReturn, innovation, logLikelihoods, learnedThrough: date },
  }
}

// Local linear state: [level, drift]' = [[1,1],[0,1]] [level, drift] + noise.
// Observation: log(price) = level + noise. Q and R depend only on v_(t-1).
function advanceKalman(previous, logPrice) {
  const levelNoise = A.equilibriumLevelNoiseRatio * previous.variance
  const driftNoise = A.equilibriumDriftNoiseRatio * previous.variance
  const observationNoise = A.equilibriumObservationNoiseRatio * previous.variance
  const level = previous.level + previous.drift
  const p00 = previous.p00 + 2 * previous.p01 + previous.p11 + levelNoise
  const p01 = previous.p01 + previous.p11
  const p11 = previous.p11 + driftNoise
  const innovationVariance = p00 + observationNoise
  const k0 = p00 / innovationVariance
  const k1 = p01 / innovationVariance
  const residual = logPrice - level
  // Joseph covariance update maintains positive covariance under roundoff.
  return {
    posterior: {
      level: level + k0 * residual,
      drift: previous.drift + k1 * residual,
      p00: Math.max(A.covarianceFloor, (1 - k0) ** 2 * p00 + k0 ** 2 * observationNoise),
      p01: (1 - k0) * (p01 - k1 * p00) + k0 * k1 * observationNoise,
      p11: Math.max(A.covarianceFloor, p11 - 2 * k1 * p01 + k1 ** 2 * (p00 + observationNoise)),
    },
    prediction: {
      logMean: level,
      logVariance: p00,
      levelProcessVariance: levelNoise,
      driftProcessVariance: driftNoise,
      observationVariance: observationNoise,
    },
  }
}

function updateExpertParameters(previous, weights, logReturn) {
  const gap = previous.level - previous.logPrice
  const reversionXX = A.parameterRetention * previous.reversionXX + weights[0] * gap ** 2
  const reversionXY = A.parameterRetention * previous.reversionXY + weights[0] * gap * logReturn
  const priorXX = A.parameterPriorSessions * A.initialVariancePerSession
  const reversionRate = Math.min(
    A.maximumReversionRate,
    Math.max(0, (priorXX * A.initialReversionRate + reversionXY) / (priorXX + reversionXX)),
  )
  const trendReturnSum = A.parameterRetention * previous.trendReturnSum + weights[1] * logReturn
  const trendWeight = A.parameterRetention * previous.trendWeight + weights[1]
  return {
    reversionXX,
    reversionXY,
    trendReturnSum,
    trendWeight,
    reversionRate,
    trendDrift: trendReturnSum / (A.parameterPriorSessions + trendWeight),
  }
}

function updateTransitionEvidence(previous, predictedWeights, weights) {
  return previous.transitionEvidence.map((row, i) =>
    row.map((value, j) => {
      const softTransition = (weights[j] * previous.weights[i] * previous.transitions[i][j]) / predictedWeights[j]
      return A.transitionRetention * value + softTransition
    }),
  )
}

export function transitionWeights(weights, matrix) {
  return weights.map((_, j) => weights.reduce((sum, weight, i) => sum + weight * matrix[i][j], 0))
}

function posteriorWeights(prior, logLikelihoods) {
  const logWeights = prior.map((weight, index) => Math.log(weight) + logLikelihoods[index])
  const largest = Math.max(...logWeights)
  return normalize(logWeights.map((weight) => Math.exp(weight - largest)))
}

function normalize(values) {
  const total = values.reduce((sum, value) => sum + value, 0)
  return values.map((value) => value / total)
}

function normalLogDensity(logPrice, { logMean, variancePerSession }) {
  return -0.5 * (Math.log(2 * Math.PI * variancePerSession) + (logPrice - logMean) ** 2 / variancePerSession)
}

function zeroMatrix() {
  return REGIME_IDS.map(() => REGIME_IDS.map(() => 0))
}
