import { FIRST_PASSAGE_LIMITS, solveFirstPassage } from '../market-model/firstPassage.js'

/**
 * Pure research/diagnostic query over simulated OrderPlan ladders:
 * 1. Computes log-uniform / sqrt(P)-geometric rung prices (constant tick spacing in concentrated AMM space)
 *    alongside OrderPlan's deterministic arithmetic rungs.
 * 2. Evaluates absorbing Markov-switching first-passage probabilities (fill-before-target vs target-before-fill)
 *    for each limit rung and stop-vs-target barrier passage from current markPrice.
 *
 * Strictly read-only diagnostic: executionAuthority = 'none', never mutates OrderPlan prices or notionals.
 */
export function evaluateOrderLadderDiagnostics({
  orders = [],
  side = null,
  markPrice = null,
  addToPrice = null,
  stopPrice = null,
  targetPrice = null,
  horizonSessions = null,
  causalState = null,
} = {}) {
  const safeOrders = Array.isArray(orders) ? orders.filter((item) => item && positive(item.price)) : []
  const resolvedSide = side ?? safeOrders[0]?.side ?? null
  const startPrice = positive(markPrice) ?? positive(safeOrders[0]?.price)
  const endPrice = positive(addToPrice) ?? positive(safeOrders.at(-1)?.price)
  const rawHorizon = positive(horizonSessions) ?? positive(safeOrders[0]?.formulaHorizonSessions)
  const discreteHorizon = rawHorizon
    ? Math.max(1, Math.min(FIRST_PASSAGE_LIMITS.maxSessions, Math.ceil(rawHorizon)))
    : null
  const causalReady = causalState?.status === 'ready' && positive(causalState?.markPrice) !== null

  const rungDiagnostics = safeOrders.map((order, index) => {
    const count = safeOrders.length
    const weight = count > 1 ? index / (count - 1) : 0
    const geometricPrice =
      startPrice !== null && endPrice !== null ? Math.pow(startPrice, 1 - weight) * Math.pow(endPrice, weight) : null
    const geometricDeltaBps =
      geometricPrice !== null && order.price > 0 ? ((geometricPrice - order.price) / order.price) * 10000 : null
    const passage =
      causalReady && discreteHorizon !== null
        ? evaluateRungPassage({ order, causalState, horizonSessions: discreteHorizon })
        : unavailableRungPassage(causalReady ? 'missing-horizon' : 'causal-model-not-ready')

    return {
      index,
      role: order.role ?? null,
      side: order.side ?? resolvedSide,
      arithmeticPrice: order.price,
      geometricPrice,
      arithmeticMinusGeometric: geometricPrice !== null ? order.price - geometricPrice : null,
      geometricDeltaBps,
      notional: positiveOrZero(order.notional),
      amount: positiveOrZero(order.amount),
      targetPrice: positive(order.targetPrice),
      ...passage,
    }
  })

  const markBarrierPassage =
    causalReady && discreteHorizon !== null
      ? evaluateMarkBarrierPassage({
          side: resolvedSide,
          stopPrice: positive(stopPrice) ?? positive(safeOrders[0]?.stopPrice),
          targetPrice: positive(targetPrice) ?? positive(safeOrders[0]?.targetPrice),
          causalState,
          horizonSessions: discreteHorizon,
        })
      : null

  const summary = summarizeLadder(rungDiagnostics)
  const hasPassage = rungDiagnostics.some((item) => Number.isFinite(item.fillBeforeTargetProb))

  return {
    status: !rungDiagnostics.length ? 'no-orders' : hasPassage ? 'ready' : 'geometry-only',
    side: resolvedSide,
    markPrice: startPrice,
    addToPrice: endPrice,
    requestedHorizonSessions: rawHorizon,
    computedHorizonSessions: discreteHorizon,
    orders: rungDiagnostics,
    markBarrierPassage,
    ...summary,
    geometryClaimClass: 'exact-identity',
    passageClaimClass: hasPassage ? 'conditional-model-probability' : 'missing-input',
    executionAuthority: 'none',
  }
}

function evaluateRungPassage({ order, causalState, horizonSessions }) {
  const spot = causalState.markPrice
  const limit = order.price
  const target = positive(order.targetPrice)
  const tol = Math.max(spot, 1) * 1e-9

  if (order.side === 'buy') {
    if (limit >= spot - tol) {
      return immediateFillPassage()
    }
    if (target === null || !(limit < spot && spot < target)) {
      return unavailableRungPassage('invalid-buy-corridor')
    }
    const fp = solveFirstPassage({
      state: causalState,
      lowerPrice: limit,
      upperPrice: target,
      horizonSessions,
    })
    if (fp.status !== 'ready') return unavailableRungPassage(fp.reason ?? fp.status)
    return {
      passageStatus: 'ready',
      passageMode: 'absorbing-corridor',
      fillBeforeTargetProb: fp.lowerProbability,
      targetBeforeFillProb: fp.upperProbability,
      neitherProb: fp.survivalProbability,
      medianSessionsToFill: fp.conditionalMedianSessions.lower,
    }
  }

  if (order.side === 'sell') {
    if (limit <= spot + tol) {
      return immediateFillPassage()
    }
    if (target === null || !(target < spot && spot < limit)) {
      return unavailableRungPassage('invalid-sell-corridor')
    }
    const fp = solveFirstPassage({
      state: causalState,
      lowerPrice: target,
      upperPrice: limit,
      horizonSessions,
    })
    if (fp.status !== 'ready') return unavailableRungPassage(fp.reason ?? fp.status)
    return {
      passageStatus: 'ready',
      passageMode: 'absorbing-corridor',
      fillBeforeTargetProb: fp.upperProbability,
      targetBeforeFillProb: fp.lowerProbability,
      neitherProb: fp.survivalProbability,
      medianSessionsToFill: fp.conditionalMedianSessions.upper,
    }
  }

  return unavailableRungPassage('unknown-order-side')
}

function evaluateMarkBarrierPassage({ side, stopPrice, targetPrice, causalState, horizonSessions }) {
  const spot = causalState.markPrice
  if (stopPrice === null || targetPrice === null) return null
  if (side === 'buy' && stopPrice < spot && spot < targetPrice) {
    const fp = solveFirstPassage({
      state: causalState,
      lowerPrice: stopPrice,
      upperPrice: targetPrice,
      horizonSessions,
    })
    if (fp.status !== 'ready') return null
    return {
      status: 'ready',
      stopBeforeTargetProb: fp.lowerProbability,
      targetBeforeStopProb: fp.upperProbability,
      survivalProb: fp.survivalProbability,
      medianSessionsToTarget: fp.conditionalMedianSessions.upper,
      medianSessionsToStop: fp.conditionalMedianSessions.lower,
    }
  }
  if (side === 'sell' && targetPrice < spot && spot < stopPrice) {
    const fp = solveFirstPassage({
      state: causalState,
      lowerPrice: targetPrice,
      upperPrice: stopPrice,
      horizonSessions,
    })
    if (fp.status !== 'ready') return null
    return {
      status: 'ready',
      stopBeforeTargetProb: fp.upperProbability,
      targetBeforeStopProb: fp.lowerProbability,
      survivalProb: fp.survivalProbability,
      medianSessionsToTarget: fp.conditionalMedianSessions.lower,
      medianSessionsToStop: fp.conditionalMedianSessions.upper,
    }
  }
  return null
}

function summarizeLadder(rungs) {
  const totalPlannedNotional = rungs.reduce((sum, item) => sum + item.notional, 0)
  const pricedRungs = rungs.filter((item) => Number.isFinite(item.fillBeforeTargetProb))
  if (!pricedRungs.length) {
    return {
      totalPlannedNotional,
      expectedFilledNotional: null,
      expectedFillShare: null,
      probabilityWeightedEntryPrice: null,
    }
  }
  const expectedFilledNotional = pricedRungs.reduce((sum, item) => sum + item.notional * item.fillBeforeTargetProb, 0)
  const expectedFilledAmount = pricedRungs.reduce(
    (sum, item) =>
      sum + (item.arithmeticPrice > 0 ? (item.notional / item.arithmeticPrice) * item.fillBeforeTargetProb : 0),
    0,
  )
  return {
    totalPlannedNotional,
    expectedFilledNotional,
    expectedFillShare: totalPlannedNotional > 0 ? expectedFilledNotional / totalPlannedNotional : null,
    probabilityWeightedEntryPrice: expectedFilledAmount > 0 ? expectedFilledNotional / expectedFilledAmount : null,
  }
}

function immediateFillPassage() {
  return {
    passageStatus: 'ready',
    passageMode: 'at-or-through-mark',
    fillBeforeTargetProb: 1,
    targetBeforeFillProb: 0,
    neitherProb: 0,
    medianSessionsToFill: 0,
  }
}

function unavailableRungPassage(reason) {
  return {
    passageStatus: 'unavailable',
    passageMode: reason,
    fillBeforeTargetProb: null,
    targetBeforeFillProb: null,
    neitherProb: null,
    medianSessionsToFill: null,
  }
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function positiveOrZero(value) {
  const next = Number(value)
  return Number.isFinite(next) && next >= 0 ? next : 0
}
