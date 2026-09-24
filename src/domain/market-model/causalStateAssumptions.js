export const CAUSAL_STATE_MODEL_VERSION = 'causal-kalman-gaussian-regime-ensemble.v1'

// These are declared priors and numerical choices, not learned facts. All
// adaptation happens after the current observation has been scored.
export const CAUSAL_STATE_ASSUMPTIONS = Object.freeze({
  initialVariancePerSession: 0.02 ** 2,
  varianceFloor: 1e-12,
  covarianceFloor: 1e-14,
  varianceLearningRate: 0.05,
  parameterRetention: 0.98,
  transitionRetention: 0.995,
  equilibriumLevelNoiseRatio: 0.02,
  equilibriumDriftNoiseRatio: 0.0002,
  equilibriumObservationNoiseRatio: 1,
  initialLevelVarianceRatio: 4,
  initialDriftVarianceRatio: 0.04,
  initialReversionRate: 0.1,
  maximumReversionRate: 0.95,
  parameterPriorSessions: 5,
  transitionPriorMassPerRow: 20,
  shockVarianceMultiplier: 9,
  minimumContiguousObservations: 8,
  initialRegimeWeights: Object.freeze([0.6, 0.3, 0.1]),
  initialTransitionMatrix: Object.freeze([
    Object.freeze([0.94, 0.05, 0.01]),
    Object.freeze([0.05, 0.93, 0.02]),
    Object.freeze([0.25, 0.25, 0.5]),
  ]),
})

export const CAUSAL_STATE_ASSUMPTION_NOTES = Object.freeze([
  'Closed rows are successive trading sessions; calendar gaps are not converted to elapsed sessions.',
  'Absent isClosed/closed flags follow the closed-daily-CSV contract; no wall-clock inference is used.',
  'Invalid or explicitly unclosed rows break the learning segment; no return is calculated across them.',
  'The equilibrium is a filtered local-linear log-price proxy, not observed investor cost or fundamental value.',
  'The Kalman filter is forward-only; each predictive density and filter noise use previous-session parameters.',
  'Regime weights are plug-in Gaussian model weights, not calibrated market-state or profit probabilities.',
  'Reversion, trend and zero-drift high-variance shock experts share an EWMA innovation variance.',
  'The adaptive soft-count Markov ensemble is not joint Bayesian parameter inference, Student-t or GARCH.',
  'Log-variance is a Kalman state uncertainty under the declared noise model, not total model uncertainty.',
  'Transition kernels condition on the current equilibrium point estimate; its uncertainty is reported separately.',
  'Ready only indicates the declared minimum contiguous sample count; fixed priors remain assumptions.',
])

export function assumptionSnapshot() {
  return {
    ...CAUSAL_STATE_ASSUMPTIONS,
    initialRegimeWeights: [...CAUSAL_STATE_ASSUMPTIONS.initialRegimeWeights],
    initialTransitionMatrix: CAUSAL_STATE_ASSUMPTIONS.initialTransitionMatrix.map((row) => [...row]),
  }
}
