import { deriveDrawdownFeatures, deriveDynamicHoldingState } from '../domain/formulas/core.js'

export function resolveDynamicHoldingData({ graph, market, rows, deviation, meanReversion, fingerprint }) {
  const entryPrice = Number.isFinite(graph.inputs?.entryPrice) ? graph.inputs.entryPrice : market?.markPrice
  const anchorPrice = market?.costAnchor
  const costLower = market?.costLow
  const zScore = deviation?.z
  const halfLifeSessions = meanReversion?.halfLifeSessions
  const hasMonotonicMeanReversion =
    meanReversion?.isMeanReverting === true &&
    meanReversion?.decayMode === 'monotonic-decay' &&
    Number.isFinite(meanReversion?.arCoefficient) &&
    meanReversion.arCoefficient > 0 &&
    meanReversion.arCoefficient < 1

  if (!hasMonotonicMeanReversion) return null
  if (![zScore, halfLifeSessions, entryPrice, anchorPrice, costLower].every(Number.isFinite)) return null
  return deriveDynamicHoldingState({
    zScore,
    halfLifeSessions,
    entryPrice,
    anchorPrice,
    targetPrices: { costLower, anchor: anchorPrice },
    drawdown: deriveDrawdownFeatures({ rows, index: rows.length - 1 }),
    lpPercentile: fingerprint?.stats?.activeShare ?? null,
    costSlopePct: Number.isFinite(market?.costSlopeRecent) ? market.costSlopeRecent * 100 : 0,
  })
}
