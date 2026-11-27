import { deriveDrawdownFeatures, deriveRunupFeatures } from '../formulas/core.js'

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
    role: '非空头瀑布下折价触及成本下沿 + 单调 AR 均值回归 + 止跌阳线 + 赔率≥1.6R → 有限分位修复止盈',
  }),
  Object.freeze({
    id: 'vol-breakout',
    label: '压缩顺势突破',
    shortLabel: '压缩突破',
    role: '双周期成本锚多头对齐 + 突破成本上沿 → 不设硬性止盈上限，沿收盘跌破自适应成本下沿完整跟踪右尾趋势',
  }),
  Object.freeze({
    id: 'overextension-fade',
    label: '溢价衰竭高抛',
    shortLabel: '溢价高抛',
    role: '空头反弹触及成本上沿或极端透支溢价 + 上影阴线失速 + 赔率≥1.6R → 回归成本中枢',
  }),
  Object.freeze({
    id: 'regime-combo',
    label: '全天候多策略',
    shortLabel: '全天候组合',
    role: '自适应双周期成本锚分流：顺势期运行压缩突破抓长右尾，震荡回撤期运行结构低吸吃均值回归',
  }),
])

const VALID_IDS = new Set(CHART_STRATEGY_CATALOG.map((item) => item.id))

export function normalizeChartStrategyId(value) {
  return VALID_IDS.has(value) ? value : 'off'
}

/**
 * Prefix-causal medium-term volume-weighted regime cost path using 3 * w_cost (~3 * sqrt(i + 1)).
 * Runs in O(N) via cumulative volume-price prefix sums with zero future lookahead.
 */
export function buildMacroCostPath(rows) {
  if (!Array.isArray(rows) || !rows.length) return []
  const pvPrefix = new Float64Array(rows.length + 1)
  const vPrefix = new Float64Array(rows.length + 1)
  const pPrefix = new Float64Array(rows.length + 1)

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const typ = (r.high + r.low + r.close) / 3
    const vol = Number.isFinite(r.volume) && r.volume > 0 ? r.volume : 0
    pvPrefix[i + 1] = pvPrefix[i] + typ * vol
    vPrefix[i + 1] = vPrefix[i] + vol
    pPrefix[i + 1] = pPrefix[i] + typ
  }

  const anchors = new Float64Array(rows.length)
  const out = new Array(rows.length)
  for (let i = 0; i < rows.length; i += 1) {
    const visible = i + 1
    const baseCostWin = Math.max(5, Math.floor(Math.sqrt(visible)))
    const win = Math.min(visible, Math.max(15, baseCostWin * 3))
    const start = visible - win
    const volSum = vPrefix[visible] - vPrefix[start]
    const anchor =
      volSum > 0 ? (pvPrefix[visible] - pvPrefix[start]) / volSum : (pPrefix[visible] - pPrefix[start]) / win
    anchors[i] = anchor
    const slopeLag = Math.min(i, baseCostWin)
    const prevAnchor = anchors[i - slopeLag] || anchor
    const slope = prevAnchor > 0 ? (anchor - prevAnchor) / prevAnchor : 0
    out[i] = { anchor, slope, windowRows: win }
  }
  return out
}

export function detectStrategySignalAt({ strategyId, index, rows, marketStates, formulaPath, macroPath }) {
  const market = marketStates?.[index]
  const row = rows?.[index]
  const macro = macroPath?.[index]
  if (!market || !row || !macro || !positive(row.close) || !positive(market.costAnchor)) return null
  const minWarmup = Math.max(15, market.windowSpec?.cost ?? 12)
  if (index < minWarmup) return null

  const formulaPoint = formulaPath?.[index] ?? null
  const bullRegime = market.costAnchor >= macro.anchor * 0.99 && macro.slope >= 0
  const bearRegime = market.costAnchor < macro.anchor * 0.99 && macro.slope < 0

  if (strategyId === 'structural-repair') {
    return detectStructuralRepair({ index, row, rows, market, formulaPoint, macro, bullRegime, bearRegime })
  }
  if (strategyId === 'vol-breakout') {
    return detectVolBreakout({ index, row, rows, market, marketStates, formulaPoint, macro, bullRegime })
  }
  if (strategyId === 'overextension-fade') {
    return detectOverextensionFade({ index, row, rows, market, formulaPoint, macro, bearRegime })
  }
  if (strategyId === 'regime-combo') {
    return (
      detectVolBreakout({ index, row, rows, market, marketStates, formulaPoint, macro, bullRegime }) ??
      detectStructuralRepair({ index, row, rows, market, formulaPoint, macro, bullRegime, bearRegime }) ??
      detectOverextensionFade({ index, row, rows, market, formulaPoint, macro, bearRegime })
    )
  }
  return null
}

function detectStructuralRepair({ index, row, rows, market, formulaPoint, macro, bullRegime, bearRegime }) {
  const atr = Math.max(market.atrPercent || 0.015, 0.008)
  // Block active markdown waterfalls; in mild drift/bear regimes require decelerating macro slope & deeper washout
  if (macro.slope < -Math.min(0.8 * atr, 0.014) || row.close < macro.anchor * (1 - Math.min(4.0 * atr, 0.085))) {
    return null
  }
  const prevRow = rows[index - 1]
  if (!prevRow || !(market.costLow < market.costAnchor)) return null

  const touchedBelowCostLow = Math.min(row.low, prevRow.low) < market.costLow
  const inDiscountZone = row.close <= market.costLow * (1 + 0.25 * atr)
  if (!(touchedBelowCostLow && inDiscountZone)) return null

  const minDiscount = bearRegime ? Math.max(1.6 * atr, 0.028) : Math.max(1.0 * atr, 0.018)
  if ((market.costAnchor - row.close) / row.close < minDiscount) return null
  if (market.costSlopeRecent < -(bearRegime ? 1.1 * atr : 1.6 * atr)) return null

  const horizonCtx = formulaPoint?.fieldStates?.formulaHorizonSessions?.context
  const mr = horizonCtx?.meanReversion
  const hasMonotonicAr =
    positive(formulaPoint?.formulaHorizonSessions) !== null ||
    (mr?.isMeanReverting === true && mr?.arCoefficient > 0.15 && mr?.arCoefficient < 0.98)
  if (!hasMonotonicAr) return null

  const swingLookback = Math.max(8, (market.windowSpec?.cost ?? 12) * 2)
  const dd = deriveDrawdownFeatures({ rows, index, lookback: swingLookback })
  if (dd?.status !== 'ok') return null

  const bullishReversal =
    row.close > prevRow.close && row.close > row.open && row.close >= row.low + 0.55 * (row.high - row.low)
  const minRepair = bearRegime ? 0.14 : 0.09
  if (!(bullishReversal && dd.drawdownRepair >= minRepair && dd.drawdownSpeedFast >= -0.02)) return null

  const localFloor = Math.min(row.low, prevRow.low) * (1 - 0.35 * atr)
  const maxAllowedRisk = Math.min(Math.max(2.2 * atr, 0.022), 0.12)
  if ((row.close - localFloor) / row.close > maxAllowedRisk * 1.2) return null
  const stopPrice = Math.max(localFloor, row.close * (1 - maxAllowedRisk))

  // Finite-q structural target (q = 0.68 < 1 per Theorem 1, avoiding asymptotic q=1 anchor trap)
  const recoveryBlend = bullRegime ? 0.72 : 0.55
  const structuralTarget = market.costLow + recoveryBlend * (market.costAnchor - market.costLow)
  const targetPrice = Math.max(structuralTarget, row.close * (1 + Math.max(1.75 * atr, 0.026)))

  const risk = row.close - stopPrice
  const reward = targetPrice - row.close
  if (!(risk > 0 && reward / risk >= 1.6)) return null

  const rawSessions =
    positive(formulaPoint?.formulaHorizonSessions) ??
    (positive(mr?.halfLifeSessions) ? mr.halfLifeSessions * 1.8 : Math.sqrt(index + 1) * 1.2)
  const horizonSessions = Math.max(5, Math.min(34, Math.ceil(rawSessions)))

  return {
    leg: 'structural-repair',
    legLabel: '低吸修复',
    side: 'buy',
    signalIndex: index,
    signalDate: row.date,
    signalClose: row.close,
    stopPrice,
    ratchetTrigger: row.close + 0.68 * reward,
    ratchetLockFraction: 0.38,
    targetPrice,
    displayTarget: targetPrice,
    trailMode: 'ratchet-profit',
    horizonSessions,
    atr,
  }
}

function detectVolBreakout({ index, row, rows, market, marketStates, formulaPoint, macro, bullRegime }) {
  // Require aligned medium-term uptrend & multi-scale cost convergence (avoid late parabolic tops)
  if (!(bullRegime && macro.slope > 0 && row.close > macro.anchor)) return null
  const prevRow = rows[index - 1]
  const prevMarket = marketStates[index - 1]
  if (!prevRow || !prevMarket || !positive(market.costHigh) || !positive(prevMarket.costHigh)) return null
  const atr = Math.max(market.atrPercent || 0.015, 0.008)

  const anchorConvergence = Math.abs(market.costAnchor - macro.anchor) / macro.anchor
  if (anchorConvergence > Math.max(5.0 * atr, 0.14)) return null

  // Prior cost-band compression check over w_cost lookback
  const costWin = Math.max(8, market.windowSpec?.cost ?? 14)
  const widths = []
  for (let k = Math.max(1, index - costWin); k < index; k += 1) {
    const st = marketStates[k]
    if (st && st.costHigh > st.costLow && st.costAnchor > 0) {
      widths.push((st.costHigh - st.costLow) / st.costAnchor)
    }
  }
  const prevWidth =
    prevMarket.costAnchor > 0 ? (prevMarket.costHigh - prevMarket.costLow) / prevMarket.costAnchor : null
  const medWidth = median(widths)
  if (prevWidth !== null && medWidth !== null && prevWidth > medWidth * 1.25) return null

  const freshBreakout =
    prevRow.close <= prevMarket.costHigh &&
    row.close > market.costHigh &&
    row.close > row.open &&
    row.close >= row.low + 0.55 * (row.high - row.low)
  if (!freshBreakout) return null
  if (!(market.costSlopeRecent >= 0 && market.momentumSlow > 0)) return null
  if ((row.close - market.costHigh) / market.costHigh > Math.max(2.2 * atr, 0.065)) return null

  const rawStop = Math.min(row.low, market.costLow) * (1 - 0.15 * atr)
  const maxAllowedRisk = Math.min(Math.max(2.8 * atr, 0.03), 0.12)
  if (rawStop >= row.close * 0.99 || (row.close - rawStop) / row.close > maxAllowedRisk * 1.25) return null
  const stopPrice = Math.max(rawStop, row.close * (1 - maxAllowedRisk))
  const risk = row.close - stopPrice
  if (!(risk > 0)) return null

  const displayTarget = positive(formulaPoint?.deltaUpper)
    ? Math.max(formulaPoint.deltaUpper, row.close + 2.0 * risk)
    : row.close + 2.5 * risk

  return {
    leg: 'vol-breakout',
    legLabel: '压缩突破',
    side: 'buy',
    signalIndex: index,
    signalDate: row.date,
    signalClose: row.close,
    stopPrice,
    // Only lock breakeven once trend has already expanded >= 2.5R (never choke early right-tail trends)
    ratchetTrigger: row.close + 2.5 * risk,
    ratchetLockFraction: 0.15,
    targetPrice: null,
    displayTarget,
    trailMode: 'uncapped-cost-low-close',
    horizonSessions: Math.max(16, Math.min(48, Math.ceil(Math.sqrt(index + 1) * 1.8))),
    atr,
  }
}

function detectOverextensionFade({ index, row, rows, market, formulaPoint, macro, bearRegime }) {
  const prevRow = rows[index - 1]
  const atr = Math.max(market.atrPercent || 0.015, 0.008)
  if (!prevRow || !(row.close > market.costHigh && market.costHigh > market.costAnchor)) return null

  const stretchOverMacro = (row.close - macro.anchor) / macro.anchor
  const confirmedBearRally = bearRegime && macro.slope < -Math.max(0.85 * atr, 0.022)
  const extremeClimax = stretchOverMacro >= Math.max(8.5 * atr, 0.28) && market.momentumFast < 0
  if (!(confirmedBearRally || extremeClimax)) return null

  const swingLookback = Math.max(8, (market.windowSpec?.cost ?? 12) * 2)
  const runup = deriveRunupFeatures({ rows, index, lookback: swingLookback })
  if (runup?.status !== 'ok') return null

  const bearishRejection =
    row.close < prevRow.close && row.close < row.open && row.high - row.close >= 0.55 * (row.high - row.low)
  const momentumStalled = market.momentumFast < market.momentumSlow * 0.85 || runup.runupSpeedFast <= 0
  if (!(bearishRejection && momentumStalled && runup.pullbackRepair >= 0.1)) return null

  const localCeiling = Math.max(row.high, prevRow.high) * (1 + 0.35 * atr)
  const maxAllowedRisk = Math.min(Math.max(2.2 * atr, 0.022), 0.12)
  if ((localCeiling - row.close) / row.close > maxAllowedRisk * 1.2) return null
  const stopPrice = Math.min(localCeiling, row.close * (1 + maxAllowedRisk))

  const targetBlend = confirmedBearRally ? 0.85 : 0.55
  const targetPrice = market.costHigh - targetBlend * (market.costHigh - market.costAnchor)
  const risk = stopPrice - row.close
  const reward = row.close - targetPrice
  if (!(risk > 0 && reward / risk >= 1.6)) return null

  const rawSessions = positive(formulaPoint?.formulaHorizonSessions) ?? Math.sqrt(index + 1)
  return {
    leg: 'overextension-fade',
    legLabel: '溢价高抛',
    side: 'sell',
    signalIndex: index,
    signalDate: row.date,
    signalClose: row.close,
    stopPrice,
    ratchetTrigger: row.close - 0.68 * reward,
    ratchetLockFraction: 0.38,
    targetPrice,
    displayTarget: targetPrice,
    trailMode: 'ratchet-profit',
    horizonSessions: Math.max(4, Math.min(26, Math.ceil(rawSessions))),
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
