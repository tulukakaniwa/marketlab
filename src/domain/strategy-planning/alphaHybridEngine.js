import { capitalEfficiency, uniswapV3Inventory } from '../formulas/core.js'
import { buildMacroCostPath, detectStrategySignalAt } from './chartStrategySignals.js'
import { checkSpotExit, finalizeSpotTrade, openTrendAtOpen, resolveMakerLadderEntry } from './makerLadderExecution.js'

const LP_ALLOCATION_CAP = 0.55

/**
 * Prefix-causal Regime-Switched 2nd-Order Engine (`lp-carry-hybrid`):
 *  - Sideways Converged Range + Monotonic AR(1) -> Delta-hedged Uniswap v3 Concentrated LP + Carry Harvest
 *  - Confirmed Cost-Band Breakout -> Immediate LP withdrawal (zero runaway IL!) + Uncapped Right-Tail Trend
 *  - Oversold Pullback -> sqrt(P) Maker Limit-Ladder Mean Reversion
 */
export function evaluateLpCarryTrendHybrid({
  rows,
  states,
  resolvedCosts,
  resolvedFormulas,
  tradingDaysPerYear,
  feeRate,
}) {
  const macroPath = buildMacroCostPath(rows)
  const trades = []
  const strategyPath = new Array(rows.length)

  let mode = 'flat'
  let lpPos = null
  let spotPos = null
  let pendingAction = null
  let realizedEquity = 1
  let peakEquity = 1
  let maxDrawdown = 0
  let cooldownUntil = 0

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const market = states[index]
    const formulaPoint = resolvedFormulas[index]
    const macro = macroPath[index]

    if (mode === 'flat' && pendingAction && pendingAction.signalIndex === index - 1) {
      if (pendingAction.kind === 'lp-range') {
        lpPos = openDeltaHedgedLpPosition(pendingAction, row, index)
        if (lpPos) mode = 'lp-range'
      } else if (pendingAction.kind === 'maker-repair') {
        spotPos = resolveMakerLadderEntry({ signal: pendingAction.signal, row, index, feeRate })
        if (spotPos) mode = 'spot-trade'
      } else if (pendingAction.kind === 'trend-breakout') {
        spotPos = openTrendAtOpen(pendingAction.signal, row, index, feeRate)
        if (spotPos) mode = 'spot-trade'
      }
      pendingAction = null
    } else if (pendingAction && pendingAction.signalIndex < index - 1) {
      pendingAction = null
    }

    let barStop = null
    let barTarget = null

    if (mode === 'lp-range' && lpPos) {
      stepLpPositionBar(lpPos, row, market, tradingDaysPerYear)
      barStop = lpPos.lowerPrice
      barTarget = lpPos.upperPrice

      const lpExit = checkLpRegimeExit(lpPos, row, market, macro, index)
      if (lpExit) {
        const closedLp = finalizeLpPosition(lpPos, lpExit, feeRate)
        trades.push(closedLp)
        realizedEquity *= 1 + closedLp.netReturn
        lpPos = null
        mode = 'flat'
        cooldownUntil = index

        if (lpExit.triggerBreakout && market && macro) {
          const breakoutSig = detectStrategySignalAt({
            strategyId: 'vol-breakout',
            index,
            rows,
            marketStates: states,
            formulaPath: resolvedFormulas,
            macroPath,
          })
          if (breakoutSig) pendingAction = { kind: 'trend-breakout', signalIndex: index, signal: breakoutSig }
        }
      }
    }

    if (mode === 'spot-trade' && spotPos) {
      if (
        spotPos.trailMode === 'uncapped-cost-low-close' &&
        positive(formulaPoint?.deltaUpper) &&
        (!spotPos.displayTarget || formulaPoint.deltaUpper > spotPos.displayTarget)
      ) {
        spotPos.displayTarget = formulaPoint.deltaUpper
      }
      barStop =
        spotPos.trailMode === 'uncapped-cost-low-close' && positive(market?.costLow)
          ? Math.max(spotPos.stopPrice, market.costLow)
          : spotPos.stopPrice
      barTarget = spotPos.targetPrice ?? spotPos.displayTarget ?? null

      const spotExit = checkSpotExit(spotPos, row, market, index)
      if (spotExit) {
        const closedSpot = finalizeSpotTrade(spotPos, spotExit)
        trades.push(closedSpot)
        realizedEquity *= 1 + closedSpot.netReturn
        spotPos = null
        mode = 'flat'
        cooldownUntil = index + 1
      }
    }

    const unrealized =
      mode === 'lp-range' && lpPos
        ? markLpUnrealized(lpPos, row.close, feeRate)
        : mode === 'spot-trade' && spotPos
          ? (row.close / spotPos.entryPrice - 1 - spotPos.feeDrag) * spotPos.positionWeight
          : 0
    const currentEquity = realizedEquity * (1 + unrealized)
    peakEquity = Math.max(peakEquity, currentEquity)
    if (peakEquity > 0) {
      maxDrawdown = Math.min(maxDrawdown, (currentEquity - peakEquity) / peakEquity)
    }

    strategyPath[index] = {
      date: row.date,
      strategyStop: barStop,
      strategyTarget: barTarget,
      strategyEquity: currentEquity * 100,
      costAnchor: resolvedCosts[index]?.anchor ?? null,
    }

    if (mode === 'flat' && !pendingAction && index >= cooldownUntil) {
      pendingAction = detectHybridOpportunity({ index, rows, states, resolvedFormulas, macroPath, tradingDaysPerYear })
    }
  }

  const activePosition = buildActiveHybridSnapshot({ mode, lpPos, spotPos, rows, states, feeRate })
  const latestSignal = pendingAction
    ? {
        leg: pendingAction.kind,
        legLabel:
          pendingAction.kind === 'lp-range'
            ? 'LP对冲收租'
            : pendingAction.kind === 'trend-breakout'
              ? '压缩突破'
              : '梯队低吸',
        side: 'buy',
        signalDate: rows[pendingAction.signalIndex]?.date,
      }
    : null

  return { trades, activePosition, latestSignal, strategyPath, realizedEquity, maxDrawdown }
}

function detectHybridOpportunity({ index, rows, states, resolvedFormulas, macroPath, tradingDaysPerYear }) {
  const breakout = detectStrategySignalAt({
    strategyId: 'vol-breakout',
    index,
    rows,
    marketStates: states,
    formulaPath: resolvedFormulas,
    macroPath,
  })
  if (breakout) return { kind: 'trend-breakout', signalIndex: index, signal: breakout }

  const repair = detectStrategySignalAt({
    strategyId: 'structural-repair',
    index,
    rows,
    marketStates: states,
    formulaPath: resolvedFormulas,
    macroPath,
  })
  if (repair) return { kind: 'maker-repair', signalIndex: index, signal: repair }

  const market = states[index]
  const row = rows[index]
  const macro = macroPath[index]
  const fp = resolvedFormulas[index]
  if (!market || !row || !macro || index < Math.max(20, market.windowSpec?.cost ?? 16)) return null
  const atr = Math.max(market.atrPercent || 0.015, 0.008)

  // Never deploy negative-Gamma LP pools inside medium-term markdown trends
  if (market.costAnchor < macro.anchor * 0.99 && macro.slope < -0.002) return null

  const inCostBand = row.close > market.costLow * (1 + 0.2 * atr) && row.close < market.costHigh * (1 - 0.2 * atr)
  const convergedAnchors = Math.abs(market.costAnchor - macro.anchor) / macro.anchor <= Math.max(1.8 * atr, 0.045)
  const flatOrMildUp = macro.slope >= -0.002 && macro.slope <= Math.max(0.85 * atr, 0.02)
  const mr = fp?.fieldStates?.formulaHorizonSessions?.context?.meanReversion
  const meanReverting = !mr || (mr.isMeanReverting && mr.arCoefficient > 0.1 && mr.arCoefficient < 0.9)
  if (!(inCostBand && convergedAnchors && flatOrMildUp && meanReverting)) return null

  const halfBand = Math.max(((market.costHigh - market.costLow) / market.costAnchor) * 0.85, 2.4 * atr, 0.04)
  const rangeWidth = Math.min(halfBand, 0.22)
  const ce = capitalEfficiency({ rangeWidth, skew: 1 })?.efficiency ?? 2
  const dailySigma = (market.annualVol || atr * Math.sqrt(tradingDaysPerYear)) / Math.sqrt(tradingDaysPerYear)
  const dailyGammaBleed = (0.5 * dailySigma * dailySigma) / Math.max(rangeWidth, 0.03)
  const estDailyFeeCarry = 0.00045 * Math.min(ce, 12) + (market.costDistance > 0 ? 0.00012 : 0.00004)
  if (estDailyFeeCarry < dailyGammaBleed * 1.15) return null

  return {
    kind: 'lp-range',
    signalIndex: index,
    rangeWidth,
    ce: Math.min(ce, 12),
    maxSessions: Math.max(10, Math.min(28, Math.ceil(Math.sqrt(index + 1) * 0.9))),
  }
}

function openDeltaHedgedLpPosition(action, row, index) {
  const startPrice = positive(row?.open) ?? positive(row?.close)
  if (!startPrice) return null
  const lowerPrice = startPrice * (1 - action.rangeWidth)
  const upperPrice = startPrice * (1 + action.rangeWidth)
  const entryInv = uniswapV3Inventory({ markPrice: startPrice, lowerPrice, upperPrice, liquidity: 1 })
  if (!entryInv || !(entryInv.value > 0)) return null

  return {
    entryIndex: index,
    entryDate: row.date,
    startPrice,
    lowerPrice,
    upperPrice,
    ce: action.ce,
    entryLpValue: entryInv.value,
    hedgeToken0: entryInv.token0,
    capitalBasis: entryInv.value * 1.45,
    positionWeight: LP_ALLOCATION_CAP,
    accruedFeeCarryQuote: 0,
    maxSessions: action.maxSessions,
  }
}

function stepLpPositionBar(lpPos, row, market, tradingDaysPerYear) {
  const barSpan = Math.max(row.high - row.low, row.close * 0.004)
  const overlapLow = Math.max(row.low, lpPos.lowerPrice)
  const overlapHigh = Math.min(row.high, lpPos.upperPrice)
  const inRangeFraction = overlapHigh > overlapLow ? (overlapHigh - overlapLow) / barSpan : 0
  if (inRangeFraction <= 0) return

  const intrabarChurn = (row.high - row.low) / Math.max(row.open, 1e-9)
  const feeRateOnLp = Math.min(intrabarChurn * 0.0042 * Math.sqrt(lpPos.ce) * inRangeFraction, 0.0045)
  const carryRate = (market?.costDistance ?? 0) >= 0 ? 0.00018 * (365 / Math.max(tradingDaysPerYear, 240)) : 0.00004
  lpPos.accruedFeeCarryQuote += lpPos.entryLpValue * (feeRateOnLp + carryRate * inRangeFraction)
}

function checkLpRegimeExit(lpPos, row, market, macro, index) {
  const heldSessions = index - lpPos.entryIndex + 1
  if (row.close >= lpPos.upperPrice || (market && row.close > market.costHigh)) {
    const bullBreak = Boolean(macro && market && market.costAnchor >= macro.anchor * 0.99 && macro.slope > 0)
    return {
      exitIndex: index,
      exitDate: row.date,
      exitPrice: row.close,
      reason: bullBreak ? '破上轨切趋势' : '出上界撤池',
      heldSessions,
      triggerBreakout: bullBreak,
    }
  }
  if (row.close <= lpPos.lowerPrice || (market && row.close < market.costLow)) {
    return {
      exitIndex: index,
      exitDate: row.date,
      exitPrice: row.close,
      reason: '破下轨撤池',
      heldSessions,
      triggerBreakout: false,
    }
  }
  if (heldSessions >= lpPos.maxSessions) {
    return {
      exitIndex: index,
      exitDate: row.date,
      exitPrice: row.close,
      reason: '收租结算',
      heldSessions,
      triggerBreakout: false,
    }
  }
  return null
}

function markLpRawReturn(lpPos, markPrice, feeRate) {
  if (!positive(markPrice)) return 0
  const cur = uniswapV3Inventory({
    markPrice,
    lowerPrice: lpPos.lowerPrice,
    upperPrice: lpPos.upperPrice,
    liquidity: 1,
  })
  if (!cur) return 0
  const lpPnl = cur.value - lpPos.entryLpValue
  const hedgePnl = -lpPos.hedgeToken0 * (markPrice - lpPos.startPrice)
  return (lpPnl + hedgePnl + lpPos.accruedFeeCarryQuote) / lpPos.capitalBasis - feeRate * 0.8
}

function markLpUnrealized(lpPos, markPrice, feeRate) {
  return markLpRawReturn(lpPos, markPrice, feeRate) * lpPos.positionWeight
}

function finalizeLpPosition(lpPos, exit, feeRate) {
  const rawNet = markLpRawReturn(lpPos, exit.exitPrice, feeRate)
  return {
    leg: 'lp-carry-range',
    legLabel: 'LP收租',
    side: 'buy',
    signalDate: lpPos.entryDate,
    entryDate: lpPos.entryDate,
    entryPrice: lpPos.startPrice,
    exitDate: exit.exitDate,
    exitPrice: exit.exitPrice,
    stopPrice: lpPos.lowerPrice,
    targetPrice: lpPos.upperPrice,
    positionWeight: lpPos.positionWeight,
    heldSessions: exit.heldSessions,
    reason: exit.reason,
    rawNetReturn: rawNet,
    grossReturn: (rawNet + feeRate * 0.8) * lpPos.positionWeight,
    netReturn: rawNet * lpPos.positionWeight,
  }
}

function buildActiveHybridSnapshot({ mode, lpPos, spotPos, rows, states, feeRate }) {
  if (mode === 'lp-range' && lpPos) {
    return {
      leg: 'lp-carry-range',
      legLabel: 'LP对冲收租',
      side: 'buy',
      entryDate: lpPos.entryDate,
      entryPrice: lpPos.startPrice,
      stopPrice: lpPos.lowerPrice,
      targetPrice: lpPos.upperPrice,
      unrealizedNetReturn: markLpUnrealized(lpPos, rows.at(-1)?.close, feeRate),
    }
  }
  if (mode === 'spot-trade' && spotPos) {
    return {
      leg: spotPos.leg,
      legLabel: spotPos.legLabel,
      side: 'buy',
      entryDate: spotPos.entryDate,
      entryPrice: spotPos.entryPrice,
      stopPrice:
        spotPos.trailMode === 'uncapped-cost-low-close' && positive(states.at(-1)?.costLow)
          ? Math.max(spotPos.stopPrice, states.at(-1).costLow)
          : spotPos.stopPrice,
      targetPrice: spotPos.targetPrice,
      unrealizedNetReturn: (rows.at(-1).close / spotPos.entryPrice - 1 - spotPos.feeDrag) * spotPos.positionWeight,
    }
  }
  return null
}

function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
