import { deriveDrawdownFeatures, deriveRunupFeatures, invertDeltaBand } from '../formulas/core.js'

export const CHART_STRATEGY_CATALOG = Object.freeze([
  Object.freeze({
    id: 'off',
    label: '关闭策略',
    shortLabel: '关闭',
    role: '仅展示基础 K 线、成本带与公式图层',
  }),
  Object.freeze({
    id: 'structural-repair',
    label: '结构低吸修复',
    shortLabel: '结构低吸',
    role: '折价跌破成本下沿 + 单调 AR 均值回归 + 摆动止跌回升 → 保本棘轮博弈成本锚修复',
  }),
  Object.freeze({
    id: 'vol-breakout',
    label: '压缩顺势突破',
    shortLabel: '压缩突破',
    role: '成本带波动收敛 + 放量突破成本上沿 + 成本重心抬升 → 沿成本下沿跟踪主升浪',
  }),
  Object.freeze({
    id: 'overextension-fade',
    label: '溢价衰竭高抛',
    shortLabel: '溢价高抛',
    role: '极端溢价偏离成本上沿 + 摆动冲高回落转弱 → 捕捉向成本上沿/成本锚的均值回归（对冲/减仓）',
  }),
  Object.freeze({
    id: 'regime-combo',
    label: '全天候多策略',
    shortLabel: '全天候组合',
    role: '现货全天候双引擎：折价区右侧结构低吸修复 + 收敛区顺势突破跟踪',
  }),
])

const VALID_IDS = new Set(CHART_STRATEGY_CATALOG.map((item) => item.id))

export function normalizeChartStrategyId(value) {
  return VALID_IDS.has(value) ? value : 'off'
}

export function detectStrategySignalAt({ strategyId, index, rows, marketStates, formulaPath, tradingDaysPerYear }) {
  const market = marketStates?.[index]
  const row = rows?.[index]
  if (!market || !row || !positive(row.close) || !positive(market.costAnchor)) return null
  const minWarmup = Math.max(10, market.windowSpec?.cost ?? 10)
  if (index < minWarmup) return null

  const formulaPoint = formulaPath?.[index] ?? null

  if (strategyId === 'structural-repair') {
    return detectStructuralRepair({ index, row, rows, market, formulaPoint })
  }
  if (strategyId === 'vol-breakout') {
    return detectVolBreakout({ index, row, rows, market, marketStates, formulaPoint, tradingDaysPerYear })
  }
  if (strategyId === 'overextension-fade') {
    return detectOverextensionFade({ index, row, rows, market, formulaPoint })
  }
  if (strategyId === 'regime-combo') {
    return (
      detectStructuralRepair({ index, row, rows, market, formulaPoint }) ??
      detectVolBreakout({ index, row, rows, market, marketStates, formulaPoint, tradingDaysPerYear })
    )
  }
  return null
}

function detectStructuralRepair({ index, row, rows, market, formulaPoint }) {
  const atr = Math.max(market.atrPercent || 0.015, 0.008)
  const prevRow = rows[index - 1]
  if (!prevRow || !(market.costLow < market.costAnchor)) return null

  // Either closing in discount below costLow OR reclaiming costLow from below on a bullish reversal bar
  const inDiscountOrReclaim =
    row.close <= market.costLow * (1 + 0.15 * atr) && Math.min(row.low, prevRow.low) < market.costLow
  if (!inDiscountOrReclaim) return null

  const discountEdge = (market.costAnchor - row.close) / row.close
  if (discountEdge < Math.max(0.9 * atr, 0.016)) return null

  // Reject structural waterfall crashes where cost anchor is collapsing rapidly
  if (market.costSlopeRecent < -Math.max(1.8 * atr, 0.025)) return null

  const horizonCtx = formulaPoint?.fieldStates?.formulaHorizonSessions?.context
  const mr = horizonCtx?.meanReversion
  const hasMonotonicAr =
    positive(formulaPoint?.formulaHorizonSessions) !== null ||
    (mr?.isMeanReverting === true && mr?.arCoefficient > 0 && mr?.arCoefficient < 1)
  if (!hasMonotonicAr) return null

  if (positive(formulaPoint?.deltaLower) && row.close < formulaPoint.deltaLower * (1 - 1.2 * atr)) {
    return null
  }

  const swingLookback = Math.max(8, (market.windowSpec?.cost ?? 12) * 2)
  const dd = deriveDrawdownFeatures({ rows, index, lookback: swingLookback })
  if (dd?.status !== 'ok') return null
  const bullishTurn = row.close > prevRow.close && row.close >= row.open
  if (!(bullishTurn && dd.drawdownRepair >= 0.1 && dd.drawdownSpeedFast >= -0.02)) return null

  const rawSessions =
    positive(formulaPoint?.formulaHorizonSessions) ??
    (positive(mr?.halfLifeSessions) ? mr.halfLifeSessions * 2.2 : Math.sqrt(index + 1) * 1.5)
  const horizonSessions = Math.max(5, Math.min(64, Math.ceil(rawSessions)))
  const swingLow = positive(dd.troughPrice) ?? Math.min(row.low, prevRow.low)
  const stopPrice = Math.min(swingLow * (1 - 0.45 * atr), row.close * (1 - Math.max(1.8 * atr, 0.022)))

  return {
    leg: 'structural-repair',
    legLabel: '低吸修复',
    side: 'buy',
    signalIndex: index,
    signalDate: row.date,
    signalClose: row.close,
    stopPrice,
    ratchetTrigger: (row.close + market.costAnchor) / 2,
    targetPrice: market.costAnchor,
    trailMode: 'ratchet-breakeven',
    horizonSessions,
    atr,
  }
}

function detectVolBreakout({ index, row, rows, market, marketStates, formulaPoint, tradingDaysPerYear }) {
  const prevRow = rows[index - 1]
  const prevMarket = marketStates[index - 1]
  if (!prevRow || !prevMarket || !positive(prevMarket.costHigh)) return null
  const atr = Math.max(market.atrPercent || 0.015, 0.008)

  const crossedUpper = prevRow.close <= prevMarket.costHigh && row.close > market.costHigh && row.close > row.open
  if (!crossedUpper) return null
  if (!(market.costSlopeRecent >= 0 && market.momentumFast > 0 && market.momentumSlow > 0)) {
    return null
  }

  // Require prior cost-band compression so we enter early expansion, not late exhaustion
  const win = Math.max(6, market.windowSpec?.cost ?? 12)
  const widths = []
  for (let k = Math.max(1, index - win); k < index; k += 1) {
    const m = marketStates[k]
    if (m?.costAnchor > 0 && m.costHigh > m.costLow) widths.push((m.costHigh - m.costLow) / m.costAnchor)
  }
  const prevWidth = (prevMarket.costHigh - prevMarket.costLow) / prevMarket.costAnchor
  const medWidth = median(widths)
  const inv =
    positive(tradingDaysPerYear) && prevMarket.costAnchor > prevMarket.costLow
      ? invertDeltaBand({
          lowerPrice: prevMarket.costLow,
          upperPrice: prevMarket.costHigh,
          entryPrice: Math.min(Math.max(prevRow.close, prevMarket.costLow), prevMarket.costHigh),
          formulaHorizonSessions: Math.max(4, Math.ceil(Math.sqrt(index))),
          tradingDaysPerYear,
          realizedVol: prevMarket.annualVol,
        })
      : null
  const compressed =
    (medWidth !== null && prevWidth <= medWidth * 1.12) ||
    (Number.isFinite(inv?.impliedToRealizedRatio) && inv.impliedToRealizedRatio <= 1.08)
  if (!compressed) return null

  const recentVols = rows
    .slice(Math.max(0, index - Math.max(4, market.windowSpec?.recent ?? 5)), index)
    .map((r) => r?.volume)
    .filter((v) => Number.isFinite(v) && v > 0)
  if (recentVols.length >= 3 && row.volume > 0) {
    const avgVol = recentVols.reduce((s, v) => s + v, 0) / recentVols.length
    if (row.volume < avgVol * 1.05) return null
  }

  // Structural stop sits below costLow (bottom of cost box), preventing T+1 retest whipsaws
  const stopPrice = Math.min(market.costLow * (1 - 0.15 * atr), row.close * (1 - Math.max(2 * atr, 0.025)))
  const bandHalfWidth = Math.max(market.costHigh - market.costAnchor, row.close * atr)
  const stretchTarget = positive(formulaPoint?.deltaUpper)
    ? Math.min(Math.max(formulaPoint.deltaUpper, row.close + 2.4 * bandHalfWidth), row.close + 4 * bandHalfWidth)
    : row.close + Math.max(2.6 * bandHalfWidth, row.close * 3.2 * atr)

  return {
    leg: 'vol-breakout',
    legLabel: '压缩突破',
    side: 'buy',
    signalIndex: index,
    signalDate: row.date,
    signalClose: row.close,
    stopPrice,
    ratchetTrigger: row.close + Math.max(1.15 * bandHalfWidth, row.close * 1.4 * atr),
    targetPrice: stretchTarget,
    trailMode: 'cost-low-trail',
    horizonSessions: Math.max(10, Math.min(60, Math.ceil(Math.sqrt(index + 1) * 2))),
    atr,
  }
}

function detectOverextensionFade({ index, row, rows, market, formulaPoint }) {
  const prevRow = rows[index - 1]
  const atr = Math.max(market.atrPercent || 0.015, 0.008)
  if (!prevRow || !(row.close > market.costHigh && market.costHigh > market.costAnchor)) return null

  const bandWidth = Math.max((market.costHigh - market.costAnchor) / market.costAnchor, atr)
  const premiumOverAnchor = (row.close - market.costAnchor) / market.costAnchor
  if (premiumOverAnchor < Math.max(1.35 * bandWidth, 1.8 * atr, 0.03)) return null

  // Require fast momentum rolling over relative to slow trend + swing pullback start
  const swingLookback = Math.max(8, (market.windowSpec?.cost ?? 12) * 2)
  const runup = deriveRunupFeatures({ rows, index, lookback: swingLookback })
  if (runup?.status !== 'ok') return null

  const bearishReversal = row.close < prevRow.close && row.close <= row.open
  const momentumRollover = market.momentumFast <= market.momentumSlow * 0.9 || runup.runupSpeedFast <= 0
  if (!(bearishReversal && momentumRollover && runup.pullbackRepair >= 0.1)) return null

  const swingPeak = positive(runup.peakPrice) ?? Math.max(row.high, prevRow.high)
  const stopPrice = Math.max(swingPeak * (1 + 0.35 * atr), row.close * (1 + Math.max(1.8 * atr, 0.022)))
  const rawSessions = positive(formulaPoint?.formulaHorizonSessions) ?? Math.sqrt(index + 1) * 1.4

  return {
    leg: 'overextension-fade',
    legLabel: '溢价高抛',
    side: 'sell',
    signalIndex: index,
    signalDate: row.date,
    signalClose: row.close,
    stopPrice,
    ratchetTrigger: market.costHigh,
    targetPrice: market.costAnchor,
    trailMode: 'ratchet-breakeven',
    horizonSessions: Math.max(5, Math.min(48, Math.ceil(rawSessions))),
    atr,
  }
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
