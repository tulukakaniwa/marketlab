import { deriveDrawdownFeatures, deriveDynamicHoldingState } from '../domain/formulas/core.js'

export function resolveDynamicHoldingData({ graph, market, rows, deviation, meanReversion, fingerprint }) {
  const entryPrice = Number.isFinite(graph.inputs?.entryPrice) ? graph.inputs.entryPrice : market?.markPrice
  const anchorPrice = market?.costAnchor
  const costLower = market?.costLow
  const zScore = deviation?.z
  const halfLifeDays = meanReversion?.halfLifeDays
  const hasMonotonicMeanReversion =
    meanReversion?.isMeanReverting === true &&
    meanReversion?.decayMode === 'monotonic-decay' &&
    Number.isFinite(meanReversion?.rho) &&
    meanReversion.rho > 0 &&
    meanReversion.rho < 1

  if (!hasMonotonicMeanReversion) return null
  if (![zScore, halfLifeDays, entryPrice, anchorPrice, costLower].every(Number.isFinite)) return null
  return deriveDynamicHoldingState({
    zScore,
    halfLifeDays,
    entryPrice,
    anchorPrice,
    targetPrices: { costLower, anchor: anchorPrice },
    drawdown: deriveDrawdownFeatures({ rows, index: rows.length - 1 }),
    lpPercentile: fingerprint?.stats?.activeShare ?? null,
    costSlopePct: Number.isFinite(market?.costSlope5) ? market.costSlope5 * 100 : 0,
  })
}
