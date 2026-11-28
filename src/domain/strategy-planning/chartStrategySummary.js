const MAX_MARKERS = 96
const MAX_LABELLED_EXITS = 8

export function buildStrategyMarkers({ trades, activePosition, pendingSignal, rows }) {
  const out = []
  const recentTrades = trades.slice(-Math.floor(MAX_MARKERS / 2))
  const labelStart = Math.max(0, recentTrades.length - MAX_LABELLED_EXITS)

  recentTrades.forEach((trade, idx) => {
    const isBuy = trade.side === 'buy'
    const isLp = trade.leg === 'lp-carry-range'
    const showLabel = idx >= labelStart
    out.push({
      time: trade.entryDate,
      position: isBuy ? 'belowBar' : 'aboveBar',
      shape: isLp ? 'circle' : isBuy ? 'arrowUp' : 'arrowDown',
      color: isLp ? '#38bdf8' : isBuy ? '#10b981' : '#f59e0b',
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
    const isLp = activePosition.leg === 'lp-carry-range'
    out.push({
      time: activePosition.entryDate,
      position: isBuy ? 'belowBar' : 'aboveBar',
      shape: isLp ? 'circle' : isBuy ? 'arrowUp' : 'arrowDown',
      color: isLp ? '#38bdf8' : isBuy ? '#10b981' : '#f59e0b',
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

export function summarizeTrades({ trades, realizedEquity, maxDrawdown, activePosition, pendingSignal, feeRate }) {
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

export function emptyStrategyResult(id, meta) {
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
