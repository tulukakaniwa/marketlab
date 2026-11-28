export const MAKER_LADDER_WEIGHTS = Object.freeze([0.25, 0.35, 0.4])
const DEFAULT_RISK_BUDGET = 0.04

/**
 * Construct a 3-rung sqrt(P)-geometric Maker limit-order ladder below signalClose.
 * Equal spacing in sqrt(P) preserves constant concentrated-liquidity curvature across rungs.
 */
export function deriveSqrtPriceLadderRungs({ signalClose, floorPrice, atr }) {
  if (!(signalClose > 0 && floorPrice > 0)) return []
  const safeAtr = Math.max(Number(atr) || 0.015, 0.008)
  const topRung = signalClose * (1 - 0.12 * safeAtr)
  const bottomRung = Math.min(topRung * (1 - 0.5 * safeAtr), Math.max(floorPrice, signalClose * (1 - 2.2 * safeAtr)))
  const sqrtTop = Math.sqrt(topRung)
  const sqrtBottom = Math.sqrt(bottomRung)

  return MAKER_LADDER_WEIGHTS.map((weight, idx) => {
    const t = idx / (MAKER_LADDER_WEIGHTS.length - 1)
    const sqrtP = sqrtTop + (sqrtBottom - sqrtTop) * t
    return { level: idx + 1, limitPrice: sqrtP * sqrtP, weight }
  })
}

/**
 * Resolve causal next-bar Maker limit-ladder fills on bar t+1.
 * Any rung with limitPrice >= row.low fills at min(row.open, limitPrice) with Maker fee discount.
 */
export function resolveMakerLadderEntry({ signal, row, index, feeRate, riskBudget = DEFAULT_RISK_BUDGET }) {
  if (!signal || signal.side !== 'buy' || !row) return null
  const floorCandidate = Math.max(signal.stopPrice * (1 + 0.35 * (signal.atr || 0.015)), signal.signalClose * 0.94)
  const rungs = deriveSqrtPriceLadderRungs({
    signalClose: signal.signalClose,
    floorPrice: floorCandidate,
    atr: signal.atr,
  })
  if (!rungs.length || row.low <= signal.stopPrice) return null

  let filledWeight = 0
  let costSum = 0
  for (const rung of rungs) {
    if (row.low <= rung.limitPrice) {
      const fillPx = Number.isFinite(row.open) && row.open < rung.limitPrice ? row.open : rung.limitPrice
      if (positive(signal.targetPrice) && fillPx >= signal.targetPrice) continue
      filledWeight += rung.weight
      costSum += rung.weight * fillPx
    }
  }
  if (!(filledWeight > 0)) return null

  const avgEntry = costSum / filledWeight
  const risk = avgEntry - signal.stopPrice
  if (!(risk > 0)) return null
  if (positive(signal.targetPrice) && (signal.targetPrice - avgEntry) / risk < 1.4) return null

  const baseRiskWeight = Math.min(1, riskBudget / Math.max(risk / avgEntry, 0.012))
  const positionWeight = baseRiskWeight * filledWeight

  return {
    ...signal,
    legLabel: `${signal.legLabel}(梯队${Math.round(filledWeight * 100)}%)`,
    entryIndex: index,
    entryDate: row.date,
    entryPrice: avgEntry,
    stopPrice: signal.stopPrice,
    initialStop: signal.stopPrice,
    ratchetTrigger: signal.trailMode === 'uncapped-cost-low-close' ? avgEntry + 2.4 * risk : signal.ratchetTrigger,
    displayTarget: positive(signal.displayTarget) ? Math.max(signal.displayTarget, avgEntry + 1.8 * risk) : null,
    positionWeight,
    filledLadderFraction: filledWeight,
    breakevenLocked: false,
    feeDrag: feeRate * 0.675,
  }
}

export function openTrendAtOpen(signal, row, index, feeRate, riskBudget = DEFAULT_RISK_BUDGET) {
  const open = positive(row?.open) ?? positive(row?.close)
  if (!open || open <= signal.stopPrice) return null
  const signalRiskPct = (signal.signalClose - signal.stopPrice) / signal.signalClose
  if ((open - signal.signalClose) / signal.signalClose > Math.max(signalRiskPct * 1.25, 0.045)) return null
  const rebasedStop = Math.max(signal.stopPrice, open * (1 - Math.min(Math.max(signalRiskPct, 0.015), 0.13)))
  const risk = open - rebasedStop
  if (!(risk > 0)) return null
  const positionWeight = Math.min(1, riskBudget / Math.max(risk / open, 0.012))
  return {
    ...signal,
    entryIndex: index,
    entryDate: row.date,
    entryPrice: open,
    stopPrice: rebasedStop,
    ratchetTrigger: open + 2.5 * risk,
    displayTarget: positive(signal.displayTarget) ? Math.max(signal.displayTarget, open + 1.8 * risk) : null,
    positionWeight,
    breakevenLocked: false,
    feeDrag: feeRate,
  }
}

export function checkSpotExit(trade, row, market, index) {
  const heldSessions = index - trade.entryIndex + 1
  if (row.low <= trade.stopPrice) {
    return {
      exitIndex: index,
      exitDate: row.date,
      exitPrice: Math.min(row.open, trade.stopPrice),
      reason: trade.breakevenLocked ? '锁利离场' : '止损离场',
      heldSessions,
    }
  }
  if (positive(trade.targetPrice) && row.high >= trade.targetPrice) {
    return {
      exitIndex: index,
      exitDate: row.date,
      exitPrice: Math.max(row.open, trade.targetPrice),
      reason: '目标止盈',
      heldSessions,
    }
  }
  if (
    trade.trailMode === 'uncapped-cost-low-close' &&
    index > trade.entryIndex &&
    positive(market?.costLow) &&
    row.close < market.costLow
  ) {
    return {
      exitIndex: index,
      exitDate: row.date,
      exitPrice: row.close,
      reason: row.close > trade.entryPrice * (1 + trade.feeDrag) ? '趋势止盈' : '破轨离场',
      heldSessions,
    }
  }
  if (!trade.breakevenLocked && positive(trade.ratchetTrigger) && row.high >= trade.ratchetTrigger) {
    const lockFrac = trade.ratchetLockFraction ?? 0.35
    const lockedStop =
      trade.entryPrice * (1 + trade.feeDrag * 1.5) + Math.max(row.high - trade.entryPrice, 0) * lockFrac
    if (row.close > lockedStop) {
      trade.stopPrice = Math.max(trade.stopPrice, lockedStop)
      trade.breakevenLocked = true
    }
  }
  const trendRunning =
    trade.trailMode === 'uncapped-cost-low-close' &&
    positive(market?.costLow) &&
    row.close >= market.costLow &&
    row.close > trade.entryPrice * (1 + trade.feeDrag * 2)
  if (heldSessions >= trade.horizonSessions && !trendRunning) {
    return { exitIndex: index, exitDate: row.date, exitPrice: row.close, reason: '周期到期', heldSessions }
  }
  return null
}

export function finalizeSpotTrade(trade, exit) {
  const rawGross = exit.exitPrice / trade.entryPrice - 1
  const weight = trade.positionWeight ?? 1
  return {
    leg: trade.leg,
    legLabel: trade.legLabel,
    side: 'buy',
    signalDate: trade.signalDate,
    entryDate: trade.entryDate,
    entryPrice: trade.entryPrice,
    exitDate: exit.exitDate,
    exitPrice: exit.exitPrice,
    stopPrice: trade.stopPrice,
    targetPrice: trade.targetPrice ?? trade.displayTarget ?? null,
    positionWeight: weight,
    heldSessions: exit.heldSessions,
    reason: exit.reason,
    rawNetReturn: rawGross - trade.feeDrag,
    grossReturn: rawGross * weight,
    netReturn: (rawGross - trade.feeDrag) * weight,
  }
}

function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
