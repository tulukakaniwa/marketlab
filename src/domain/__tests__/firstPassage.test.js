import { describe, expect, it } from 'vitest'
import { FIRST_PASSAGE_LIMITS, solveFirstPassage } from '../market-model/firstPassage.js'

const makeRegime = (changes = {}) => ({
  id: 'range',
  weight: 1,
  driftPerSession: 0,
  reversionRate: 0,
  variancePerSession: 0.01,
  ...changes,
})
function state(components = [makeRegime()], transitionMatrix = [[1]]) {
  return {
    status: 'ready',
    markPrice: 100,
    equilibrium: { logPrice: Math.log(100) },
    dynamics: { components, transitionMatrix },
  }
}
function solve(changes = {}) {
  return solveFirstPassage({
    state: state(),
    lowerPrice: 100 * Math.exp(-0.1),
    upperPrice: 100 * Math.exp(0.1),
    horizonSessions: 8,
    ...changes,
  })
}

describe('session-close first passage from an as-of snapshot', () => {
  it('integrates a single step from the precise mark, including both Gaussian tails', () => {
    const result = solve({ horizonSessions: 1, gridSize: 3 })
    expect(result.status).toBe('ready')
    expect(result.lowerProbability).toBeCloseTo(0.158655253931457, 6)
    expect(result.upperProbability).toBeCloseTo(0.158655253931457, 6)
    expect(result.survivalProbability).toBeCloseTo(0.682689492137086, 6)
    expect(result.conditionalMedianSessions).toEqual({ lower: 1, upper: 1 })
    expect(result.observationMode).toBe('session-close')
    expect(result.parameterEvolution).toBe('frozen-at-observation')
  })

  it('keeps symmetry, total probability and monotone cumulative absorption', () => {
    const result = solve({ horizonSessions: 80 })
    expect(result.status).toBe('ready')
    expect(result.lowerProbability).toBeCloseTo(result.upperProbability, 12)
    let previous = { lowerCumulative: 0, upperCumulative: 0, survival: 1 }
    for (const row of result.distribution) {
      expect(row.lowerCumulative + row.upperCumulative + row.survival).toBeCloseTo(1, 12)
      expect(row.lowerCumulative).toBeGreaterThanOrEqual(previous.lowerCumulative)
      expect(row.upperCumulative).toBeGreaterThanOrEqual(previous.upperCumulative)
      expect(row.survival).toBeLessThanOrEqual(previous.survival + 1e-14)
      expect(row.lower).toBeGreaterThanOrEqual(0)
      expect(row.upper).toBeGreaterThanOrEqual(0)
      previous = row
    }
  })

  it('preserves an exact zero-volatility path instead of moving it to cell centers', () => {
    const input = state([makeRegime({ variancePerSession: 0, driftPerSession: 0.03 })])
    const result = solve({ state: input, gridSize: 3 })
    expect(result.numerical.method).toBe('exact-deterministic-session-recursion')
    expect(result.upperProbability).toBe(1)
    expect(result.lowerProbability).toBe(0)
    expect(result.conditionalMedianSessions).toEqual({ lower: null, upper: 4 })
    expect(result.distribution[2].survival).toBe(1)
    expect(result.distribution[3].upper).toBe(1)
    const fixed = solve({ state: state([makeRegime({ variancePerSession: 0 })]) })
    expect(fixed.survivalProbability).toBe(1)
    expect(fixed.conditionalMedianSessions).toEqual({ lower: null, upper: null })
  })

  it('applies state transitions before destination dynamics and preserves state persistence', () => {
    const components = [
      makeRegime({ id: 'up', weight: 1, driftPerSession: 0.07, variancePerSession: 0 }),
      makeRegime({ id: 'down', weight: 0, driftPerSession: -0.07, variancePerSession: 0 }),
    ]
    const persistent = solve({
      state: state(components, [
        [1, 0],
        [0, 1],
      ]),
      horizonSessions: 3,
    })
    const alternating = solve({
      state: state(components, [
        [0, 1],
        [1, 0],
      ]),
      horizonSessions: 3,
    })
    expect(persistent.upperProbability).toBe(1)
    expect(alternating.survivalProbability).toBe(1)
    const immediateSwitch = solve({
      state: state(components, [
        [0, 1],
        [0, 1],
      ]),
      lowerPrice: 100 * Math.exp(-0.05),
      horizonSessions: 1,
    })
    expect(immediateSwitch.lowerProbability).toBe(1)
    expect(immediateSwitch.upperProbability).toBe(0)
  })

  it('absorbs existing boundary touches at session zero', () => {
    const lower = solve({ lowerPrice: 100 })
    expect(lower.lowerProbability).toBe(1)
    expect(lower.conditionalMedianSessions.lower).toBe(0)
    expect(lower.distribution[0].session).toBe(0)
    const upper = solve({ upperPrice: 100 })
    expect(upper.upperProbability).toBe(1)
    expect(upper.conditionalMedianSessions.upper).toBe(0)
  })

  it('bounds runtime explicitly and reports horizon truncation', () => {
    const result = solve({ horizonSessions: 1000000, maxSessions: 5 })
    expect(result.computedHorizonSessions).toBe(5)
    expect(result.requestedHorizonSessions).toBe(1000000)
    expect(result.distribution).toHaveLength(5)
    expect(result.truncated).toBe(true)
    expect(solve({ maxSessions: FIRST_PASSAGE_LIMITS.maxSessions + 1 }).status).toBe('invalid-input')
    expect(solve({ gridSize: FIRST_PASSAGE_LIMITS.maxGridSize + 1 }).status).toBe('invalid-input')
    expect(solve({ horizonSessions: Infinity }).status).toBe('invalid-input')
  })

  it('is invariant to the price denomination and does not mutate the snapshot', () => {
    const snapshot = state([makeRegime({ driftPerSession: -0.006, reversionRate: 0.18 })])
    snapshot.equilibrium.logPrice = Math.log(102)
    const before = JSON.stringify(snapshot)
    const original = solve({ state: snapshot })
    const factor = 3500
    const scaled = solve({
      state: {
        ...snapshot,
        markPrice: snapshot.markPrice * factor,
        equilibrium: { logPrice: snapshot.equilibrium.logPrice + Math.log(factor) },
      },
      lowerPrice: 100 * Math.exp(-0.1) * factor,
      upperPrice: 100 * Math.exp(0.1) * factor,
    })
    expect(scaled.lowerProbability).toBeCloseTo(original.lowerProbability, 12)
    expect(scaled.upperProbability).toBeCloseTo(original.upperProbability, 12)
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it('retains Gaussian far tails and rejects malformed stochastic parameters', () => {
    const result = solve({ lowerPrice: 100 * Math.exp(-0.8), upperPrice: 100 * Math.exp(0.8), horizonSessions: 1 })
    expect(result.lowerProbability).toBeGreaterThan(0)
    expect(result.upperProbability).toBeGreaterThan(0)
    expect(result.lowerProbability).toBeLessThan(1e-14)
    expect(solve({ state: state([makeRegime({ variancePerSession: Infinity })]) }).status).toBe('invalid-input')
    expect(solve({ state: state([makeRegime({ weight: 0.4 })]) }).status).toBe('invalid-input')
    expect(solve({ state: state([makeRegime()], [[0.7]]) }).status).toBe('invalid-input')
    expect(solve({ state: { status: 'missing-input' } }).status).toBe('missing-input')
    const overflow = state([makeRegime({ driftPerSession: 1e308, reversionRate: 1e308 })])
    overflow.equilibrium.logPrice = 1000
    expect(solve({ state: overflow }).status).toBe('numerical-failure')
  })
})
