import { describe, expect, it } from 'vitest'
import { buildCausalModelSnapshot, deriveCausalPassageQuery, queryCausalPassage } from '../market-model/causalModel.js'

function rows(count) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 * Math.exp(0.001 * index + 0.025 * Math.sin(index / 3))
    return {
      date: new Date(Date.UTC(2024, 0, index + 1)).toISOString().slice(0, 10),
      open: close * 0.998,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 1000 + index,
    }
  })
}

function state({ anchor = 110, variance = 0.0004 } = {}) {
  return {
    status: 'ready',
    markPrice: 100,
    equilibrium: { price: anchor, logPrice: Math.log(anchor) },
    dynamics: {
      components: [
        { id: 'reversion', weight: 1, driftPerSession: 0, reversionRate: 0.1, variancePerSession: variance },
      ],
      transitionMatrix: [[1]],
    },
  }
}

describe('causal model public query', () => {
  it('never reads rows after the explicit observation point, including their validation state', () => {
    const prefix = rows(90)
    const future = [{ date: '2027-01-01', close: 1e100, isClosed: false }, null]
    const before = buildCausalModelSnapshot({ rows: prefix, tradingDaysPerYear: 242 })
    const after = buildCausalModelSnapshot({
      rows: [...prefix, ...future],
      observationIndex: 89,
      tradingDaysPerYear: 242,
    })
    expect(before.status).toBe('ready')
    expect(after).toEqual(before)
    expect(after.parametersThrough).toBe(prefix.at(-1).date)
    expect(after.availableAt).toBe(`${prefix.at(-1).date}:close`)
    expect(after.futureRowsUsed).toBe(false)
  })

  it('chart history is prefix-invariant and leaves warmup and invalid segments empty', () => {
    const history = rows(40)
    history[20].isClosed = false
    const full = buildCausalModelSnapshot({ rows: history, tradingDaysPerYear: 242 })
    expect(full.chartPath[0].equilibriumPrice).toBeNull()
    expect(full.chartPath[19].equilibriumPrice).toBeGreaterThan(0)
    expect(full.chartPath[20].equilibriumPrice).toBeNull()
    expect(full.chartPath[21].equilibriumPrice).toBeNull()
    for (const index of [10, 19, 20, 29, 39]) {
      const prefix = buildCausalModelSnapshot({ rows: history, observationIndex: index, tradingDaysPerYear: 242 })
      expect(prefix.chartPath).toEqual(full.chartPath.slice(0, index + 1))
      expect(prefix.chartPath.at(-1).equilibriumPrice).toBe(
        prefix.state.status === 'ready' ? prefix.state.equilibrium.price : null,
      )
    }
  })

  it('does not accept future volatility, manual holding periods, or external fitted parameters', () => {
    const input = { rows: rows(70), tradingDaysPerYear: 242 }
    expect(
      buildCausalModelSnapshot({
        ...input,
        iv: 999,
        holdingDays: 999,
        formulaHorizonSessions: 999,
        targetPrice: 999,
        fittedParameters: { slope: 10 },
      }),
    ).toEqual(buildCausalModelSnapshot(input))
  })

  it('does not mutate market observations or create execution authority', () => {
    const history = rows(70).map(Object.freeze)
    Object.freeze(history)
    const snapshot = buildCausalModelSnapshot({ rows: history, tradingDaysPerYear: 242 })
    expect(snapshot.executionAuthority).toBe('none')
    expect(snapshot.passage.executionAuthority).toBe('none')
    expect(snapshot.state.equilibrium.price).toBeGreaterThan(0)
    expect(snapshot.assumptions).toContain('filtered-equilibrium-is-not-observed-position-cost')
    expect(snapshot.assumptions).toContain('transition-parameters-and-equilibrium-frozen-at-observation')
  })

  it('blocks unclosed final sessions and unavailable inputs', () => {
    const history = rows(70)
    history.at(-1).isClosed = false
    expect(buildCausalModelSnapshot({ rows: history, tradingDaysPerYear: 242 }).status).toBe('invalid-data')
    expect(buildCausalModelSnapshot({ rows: [] }).status).toBe('warming-up')
    expect(buildCausalModelSnapshot({ rows: rows(70) }).status).toBe('invalid-data')
    expect(buildCausalModelSnapshot({ rows: rows(70), tradingDaysPerYear: 242, observationIndex: 70 }).status).toBe(
      'invalid-data',
    )
  })
})

describe('current-state passage boundaries and time scale', () => {
  it('uses symmetric log boundaries and an observed diffusion scale, with no fixed market horizon', () => {
    const current = state()
    const query = deriveCausalPassageQuery(current)
    expect(query.side).toBe('long')
    expect(query.targetPrice).toBe(110)
    expect(query.riskPrice).toBeCloseTo(10000 / 110, 10)
    expect(Math.log(query.targetPrice / 100)).toBeCloseTo(Math.log(100 / query.riskPrice), 12)
    expect(query.horizonSessions).toBe(Math.ceil(Math.log(1.1) ** 2 / 0.0004))
    expect(query.equilibriumUncertaintyIncludedInPassage).toBe(false)
    expect(deriveCausalPassageQuery(state({ variance: 0.004 })).horizonSessions).toBeLessThan(query.horizonSessions)
  })

  it('maps target and risk to the correct boundary for both directions', () => {
    for (const anchor of [90, 110]) {
      const result = queryCausalPassage(state({ anchor }))
      expect(result.status).toBe('ready')
      expect(result.targetProbability).toBe(anchor > 100 ? result.upperProbability : result.lowerProbability)
      expect(result.riskProbability).toBe(anchor > 100 ? result.lowerProbability : result.upperProbability)
      expect(result.targetProbability + result.riskProbability + result.survivalProbability).toBeCloseTo(1, 9)
      expect(result.observationMode).toBe('session-close')
    }
  })

  it('discloses computation truncation instead of silently changing the requested model window', () => {
    const result = queryCausalPassage(state({ variance: 1e-6 }))
    expect(result.status).toBe('ready')
    expect(result.horizonSessions).toBeGreaterThan(128)
    expect(result.requestedHorizonSessions).toBe(result.horizonSessions)
    expect(result.computedHorizonSessions).toBe(128)
    expect(result.truncated).toBe(true)
  })

  it('does not fabricate a directional target or diffusion time for degenerate states', () => {
    expect(deriveCausalPassageQuery(state({ anchor: 100 })).reason).toBe('at-equilibrium')
    expect(deriveCausalPassageQuery(state({ variance: 0 })).reason).toBe('degenerate-diffusion-scale')
    expect(deriveCausalPassageQuery({ status: 'warming-up' }).reason).toBe('state-not-ready')
  })
})
