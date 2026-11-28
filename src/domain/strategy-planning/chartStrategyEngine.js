import { buildCostPath, buildMarketStatePath } from '../market-data/cost.js'
import { buildFormulaPath } from '../formula-research/path/formulaPath.js'
import {
  CHART_STRATEGY_CATALOG,
  buildMacroCostPath,
  detectStrategySignalAt,
  normalizeChartStrategyId,
} from './chartStrategySignals.js'

export { CHART_STRATEGY_CATALOG, normalizeChartStrategyId }

const MAX_MARKERS = 96
const MAX_LABELLED_EXITS = 8
const RISK_BUDGET_PER_TRADE = 0.035

/**
 * Pure prefix-causal multi-strategy evaluator for interactive chart overlay & research verification.
 * Signal at bar t close -> entry at bar t+1 open; stop-first intrabar; constant risk-budget sizing.
 */
export function evaluateChartStrategy({
  strategyId = 'off',
  rows = [],
  costPath = null,
  formulaPath = null,
  marketStates = null,
  tradingDaysPerYear = null,
  feeRate = 0.001,
} = {}) {
  const id = normalizeChartStrategyId(strategyId)
  const meta = CHART_STRATEGY_CATALOG.find((item) => item.id === id) ?? CHART_STRATEGY_CATALOG[0]
  if (id === 'off' || !Array.isArray(rows) || rows.length < 10 || !positive(tradingDaysPerYear)) {
    return emptyStrategyResult(id, meta)
  }

  const tdpy = Number(tradingDaysPerYear)
  const drag = Number.isFinite(feeRate) && feeRate >= 0 && feeRate < 0.1 ? Number(feeRate) : 0.001
  const states =
    Array.isArray(marketStates) && marketStates.length === rows.length ? marketStates : buildMarketStatePath(rows, tdpy)
  const resolvedCosts =
    Array.isArray(costPath) && costPath.length >= rows.length ? costPath : buildCostPath(rows, null, tdpy)
  const resolvedFormulas =
    Array.isArray(formulaPath) && formulaPath.length === rows.length
      ? formulaPath
      : buildFormulaPath(rows, { tradingDaysPerYear: tdpy })
  const macroPath = buildMacroCostPath(rows)

  const trades = []
  const strategyPath = new Array(rows.length)
  let openTrade = null
  let pendingSignal = null
  let realizedEquity = 1
  let peakEquity = 1
  let maxDrawdown = 0
  let cooldownUntil = 0

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const market = states[index]
    const formulaPoint = resolvedFormulas[index]

    if (!openTrade && pendingSignal && pendingSignal.signalIndex === index - 1) {
      openTrade = tryEnterAtOpen(pendingSignal, row, index, drag)
      pendingSignal = null
    } else if (pendingSignal && pendingSignal.signalIndex < index - 1) {
      pendingSignal = null
    }

    let barStop = null
    let barTarget = null
    if (openTrade) {
      updateTrailingRails(openTrade, market, formulaPoint, index)
      barStop =
        openTrade.trailMode === 'uncapped-cost-low-close' && positive(market?.costLow)
          ? Math.max(openTrade.stopPrice, market.costLow)
          : openTrade.stopPrice
      barTarget = openTrade.targetPrice ?? openTrade.displayTarget ?? null

      const exit = resolveBarExit(openTrade, row, market, index)
      if (exit) {
        const closed = finalizeTrade(openTrade, exit, drag)
        trades.push(closed)
        realizedEquity *= 1 + closed.netReturn
        openTrade = null
        cooldownUntil = index + 1
      }
    }

    const unrealizedReturn = openTrade ? markUnrealizedReturn(openTrade, row.close, drag) : 0
    const currentEquity = realizedEquity * (1 + unrealizedReturn)
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

    if (!openTrade && index >= cooldownUntil) {
      pendingSignal = detectStrategySignalAt({
        strategyId: id,
        index,
        rows,
        marketStates: states,
        formulaPath: resolvedFormulas,
        macroPath,
      })
    }
  }

  const activePosition = openTrade ? snapshotOpenTrade(openTrade, rows.at(-1), states.at(-1), drag) : null
  const markers = buildStrategyMarkers({ trades, activePosition, pendingSignal, rows })
  const summary = summarizeTrades({ trades, realizedEquity, maxDrawdown, activePosition, pendingSignal, feeRate: drag })

  return {
    active: true,
    status: 'ready',
    strategyId: id,
    label: meta.label,
    shortLabel: meta.shortLabel,
    role: meta.role,
    feeRate: drag,
    intrabarPolicy: 'stop-first-conservative-when-both-hit',
    claimClass: 'scenario-proxy',
    executionAuthority: 'none',
    trades,
    activePosition,
    latestSignal: pendingSignal,
    strategyPath,
    markers,
    summary,
  }
}

function tryEnterAtOpen(signal, row, index, drag) {
  const open = positive(row?.open) ?? positive(row?.close)
  if (!open) return null
  const isBuy = signal.side === 'buy'
  if (isBuy) {
    if (open <= signal.stopPrice || (positive(signal.targetPrice) && open >= signal.targetPrice)) return null
    const signalRiskPct = (signal.signalClose - signal.stopPrice) / signal.signalClose
    if ((open - signal.signalClose) / signal.signalClose > Math.max(signalRiskPct * 1.25, 0.045)) return null
    const rebasedStop = Math.max(signal.stopPrice, open * (1 - Math.min(Math.max(signalRiskPct, 0.015), 0.13)))
    const risk = open - rebasedStop
    if (!(risk > 0)) return null
    if (positive(signal.targetPrice) && (signal.targetPrice - open) / risk < 1.35) return null
    const positionWeight = Math.min(1, RISK_BUDGET_PER_TRADE / Math.max(risk / open, 0.012))
    const rebasedRatchet =
      signal.trailMode === 'uncapped-cost-low-close' && positive(signal.ratchetTrigger)
        ? open + 2.5 * risk
        : signal.ratchetTrigger
    return {
      ...signal,
      entryIndex: index,
      entryDate: row.date,
      entryPrice: open,
      stopPrice: rebasedStop,
      initialStop: rebasedStop,
      ratchetTrigger: rebasedRatchet,
      displayTarget: positive(signal.displayTarget) ? Math.max(signal.displayTarget, open + 1.8 * risk) : null,
      positionWeight,
      breakevenLocked: false,
      feeDrag: drag,
    }
  }
  if (open >= signal.stopPrice || (positive(signal.targetPrice) && open <= signal.targetPrice)) return null
  const signalRiskPct = (signal.stopPrice - signal.signalClose) / signal.signalClose
  const rebasedStop = Math.min(signal.stopPrice, open * (1 + Math.min(Math.max(signalRiskPct, 0.015), 0.13)))
  const risk = rebasedStop - open
  if (!(risk > 0 && (open - signal.targetPrice) / risk >= 1.35)) return null
  const positionWeight = Math.min(1, RISK_BUDGET_PER_TRADE / Math.max(risk / open, 0.012))
  return {
    ...signal,
    entryIndex: index,
    entryDate: row.date,
    entryPrice: open,
    stopPrice: rebasedStop,
    initialStop: rebasedStop,
    positionWeight,
    breakevenLocked: false,
    feeDrag: drag,
  }
}

function updateTrailingRails(trade, market, formulaPoint, index) {
  if (index <= trade.entryIndex || !market) return
  if (trade.trailMode === 'uncapped-cost-low-close' && trade.side === 'buy') {
    if (positive(formulaPoint?.deltaUpper) && (!trade.displayTarget || formulaPoint.deltaUpper > trade.displayTarget)) {
      trade.displayTarget = formulaPoint.deltaUpper
    }
  }
}

function resolveBarExit(trade, row, market, index) {
  const heldSessions = index - trade.entryIndex + 1
  if (trade.side === 'buy') {
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
  } else {
    if (row.high >= trade.stopPrice) {
      return {
        exitIndex: index,
        exitDate: row.date,
        exitPrice: Math.max(row.open, trade.stopPrice),
        reason: trade.breakevenLocked ? '锁利平空' : '止损离场',
        heldSessions,
      }
    }
    if (positive(trade.targetPrice) && row.low <= trade.targetPrice) {
      return {
        exitIndex: index,
        exitDate: row.date,
        exitPrice: Math.min(row.open, trade.targetPrice),
        reason: '目标止盈',
        heldSessions,
      }
    }
    if (!trade.breakevenLocked && positive(trade.ratchetTrigger) && row.low <= trade.ratchetTrigger) {
      const lockFrac = trade.ratchetLockFraction ?? 0.35
      const lockedStop =
        trade.entryPrice * (1 - trade.feeDrag * 1.5) - Math.max(trade.entryPrice - row.low, 0) * lockFrac
      if (row.close < lockedStop) {
        trade.stopPrice = Math.min(trade.stopPrice, lockedStop)
        trade.breakevenLocked = true
      }
    }
  }

  const trendRunning =
    trade.trailMode === 'uncapped-cost-low-close' &&
    trade.side === 'buy' &&
    positive(market?.costLow) &&
    row.close >= market.costLow &&
    row.close > trade.entryPrice * (1 + trade.feeDrag * 2)
  if (heldSessions >= trade.horizonSessions && !trendRunning) {
    return { exitIndex: index, exitDate: row.date, exitPrice: row.close, reason: '周期到期', heldSessions }
  }
  return null
}

function finalizeTrade(trade, exit, drag) {
  const rawGross =
    trade.side === 'buy'
      ? exit.exitPrice / trade.entryPrice - 1
      : (trade.entryPrice - exit.exitPrice) / trade.entryPrice
  const weight = trade.positionWeight ?? 1
  return {
    leg: trade.leg,
    legLabel: trade.legLabel,
    side: trade.side,
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
    rawNetReturn: rawGross - drag,
    grossReturn: rawGross * weight,
    netReturn: (rawGross - drag) * weight,
  }
}

function markUnrealizedReturn(trade, closePrice, drag) {
  if (!positive(closePrice)) return 0
  const gross =
    trade.side === 'buy' ? closePrice / trade.entryPrice - 1 : (trade.entryPrice - closePrice) / trade.entryPrice
  return (gross - drag) * (trade.positionWeight ?? 1)
}

function snapshotOpenTrade(trade, lastRow, lastMarket, drag) {
  const mark = lastRow?.close ?? trade.entryPrice
  const liveStop =
    trade.trailMode === 'uncapped-cost-low-close' && positive(lastMarket?.costLow)
      ? Math.max(trade.stopPrice, lastMarket.costLow)
      : trade.stopPrice
  return {
    leg: trade.leg,
    legLabel: trade.legLabel,
    side: trade.side,
    entryDate: trade.entryDate,
    entryPrice: trade.entryPrice,
    stopPrice: liveStop,
    targetPrice: trade.targetPrice,
    displayTarget: trade.displayTarget ?? null,
    trailMode: trade.trailMode,
    breakevenLocked: trade.breakevenLocked,
    unrealizedNetReturn: markUnrealizedReturn(trade, mark, drag),
  }
}

function buildStrategyMarkers({ trades, activePosition, pendingSignal, rows }) {
  const out = []
  const recentTrades = trades.slice(-Math.floor(MAX_MARKERS / 2))
  const labelStart = Math.max(0, recentTrades.length - MAX_LABELLED_EXITS)

  recentTrades.forEach((trade, idx) => {
    const isBuy = trade.side === 'buy'
    const showLabel = idx >= labelStart
    out.push({
      time: trade.entryDate,
      position: isBuy ? 'belowBar' : 'aboveBar',
      shape: isBuy ? 'arrowUp' : 'arrowDown',
      color: isBuy ? '#10b981' : '#f59e0b',
      ...(showLabel ? { text: trade.legLabel } : {}),
      id: `strat-in-${idx}`,
    })
    const win = trade.netReturn >= 0
    out.push({
      time: trade.exitDate,
      position: win ? 'aboveBar' : 'belowBar',
      shape: 'circle',
      color: win ? '#10b981' : '#ef4444',
      ...(showLabel ? { text: `${win ? '+' : ''}${(trade.netReturn * 100).toFixed(1)}%` } : {}),
      id: `strat-out-${idx}`,
    })
  })

  if (activePosition) {
    const isBuy = activePosition.side === 'buy'
    out.push({
      time: activePosition.entryDate,
      position: isBuy ? 'belowBar' : 'aboveBar',
      shape: isBuy ? 'arrowUp' : 'arrowDown',
      color: isBuy ? '#10b981' : '#f59e0b',
      text: `${activePosition.legLabel}持仓`,
      id: 'strat-active-entry',
    })
  } else if (pendingSignal && rows.length) {
    const isBuy = pendingSignal.side === 'buy'
    out.push({
      time: pendingSignal.signalDate,
      position: isBuy ? 'belowBar' : 'aboveBar',
      shape: isBuy ? 'arrowUp' : 'arrowDown',
      color: '#38bdf8',
      text: `信号:${pendingSignal.legLabel}`,
      id: 'strat-pending-signal',
    })
  }
  return out
}

function summarizeTrades({ trades, realizedEquity, maxDrawdown, activePosition, pendingSignal, feeRate }) {
  const closedCount = trades.length
  const wins = trades.filter((t) => t.netReturn > 0)
  const losses = trades.filter((t) => t.netReturn <= 0)
  const grossWinSum = wins.reduce((s, t) => s + t.netReturn, 0)
  const grossLossAbs = Math.abs(losses.reduce((s, t) => s + t.netReturn, 0))
  return {
    closedCount,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: closedCount > 0 ? wins.length / closedCount : null,
    profitFactor: grossLossAbs > 0 ? grossWinSum / grossLossAbs : wins.length > 0 ? Infinity : null,
    totalNetReturn: realizedEquity - 1,
    avgNetReturn: closedCount > 0 ? trades.reduce((s, t) => s + t.netReturn, 0) / closedCount : null,
    maxDrawdown,
    feeRate,
    liveState: activePosition ? 'in-position' : pendingSignal ? 'signal-ready' : 'waiting',
  }
}

function emptyStrategyResult(id, meta) {
  return {
    active: false,
    status: id === 'off' ? 'off' : 'missing-input',
    strategyId: id,
    label: meta.label,
    shortLabel: meta.shortLabel,
    role: meta.role,
    feeRate: 0.001,
    intrabarPolicy: 'stop-first-conservative-when-both-hit',
    claimClass: 'scenario-proxy',
    executionAuthority: 'none',
    trades: [],
    activePosition: null,
    latestSignal: null,
    strategyPath: [],
    markers: [],
    summary: {
      closedCount: 0,
      winCount: 0,
      lossCount: 0,
      winRate: null,
      profitFactor: null,
      totalNetReturn: 0,
      avgNetReturn: null,
      maxDrawdown: 0,
      feeRate: 0.001,
      liveState: 'off',
    },
  }
}

function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
