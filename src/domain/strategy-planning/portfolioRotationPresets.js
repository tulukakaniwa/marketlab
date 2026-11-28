export const ROTATION_PRESETS = Object.freeze([
  Object.freeze({
    id: 'global-flagship',
    label: '全市场旗舰轮动 (18标的)',
    shortLabel: '全球跨资产',
    description: '加密核心 + 美股 AI 算力 + 港股/A股新能源龙头，跨市场回收闲置现金',
    symbols: [
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
      'BNBUSDT',
      'LINKUSDT',
      'NVDA',
      'META',
      'TSLA',
      'AVGO',
      'MSFT',
      'AAPL',
      'AMZN',
      'QQQ',
      '0700.HK',
      '1810.HK',
      '3690.HK',
      '300750',
      '300308',
    ],
  }),
  Object.freeze({
    id: 'crypto-majors',
    label: '加密主流轮动 (12币种)',
    shortLabel: '加密12币',
    description: '12 大高流动性加密资产顺势突破 + √P 梯队低吸轮动',
    symbols: [
      'BTCUSDT',
      'ETHUSDT',
      'SOLUSDT',
      'BNBUSDT',
      'XRPUSDT',
      'DOGEUSDT',
      'ADAUSDT',
      'AVAXUSDT',
      'LINKUSDT',
      'DOTUSDT',
      'UNIUSDT',
      'AAVEUSDT',
    ],
  }),
  Object.freeze({
    id: 'us-tech-leaders',
    label: '美股科技算力池 (10股)',
    shortLabel: '美股科技',
    description: '美股科技巨头与指数 ETF 多头收敛突破 + 回调梯队轮动',
    symbols: ['NVDA', 'META', 'TSLA', 'AVGO', 'MSFT', 'AAPL', 'AMZN', 'GOOG', 'QQQ', 'SPY'],
  }),
  Object.freeze({
    id: 'cn-hk-growth',
    label: 'A股+港股核心龙头 (14股)',
    shortLabel: 'A+H龙头',
    description: 'A股光模块/锂电/制造与港股科技龙头多标的资金轮动',
    symbols: [
      '0700.HK',
      '1810.HK',
      '3690.HK',
      '9988.HK',
      '1211.HK',
      '300750',
      '300308',
      '300502',
      '002594',
      '002371',
      '601899',
      '600519',
      '300274',
      '688256',
    ],
  }),
])

/**
 * Score a T-1 candidate cross-sectionally by endogenous expected return velocity:
 *   score = (expectedUpside - 2 * feeRate) / max(horizonSessions, 4)
 * Strictly causal: uses only state known at signal bar close.
 */
export function scoreRotationCandidate(signal, feeRate = 0.001) {
  if (!signal || !(signal.signalClose > 0)) return 0
  const refTarget = signal.targetPrice ?? signal.displayTarget ?? signal.signalClose * 1.08
  const expectedUpside = Math.max(0, refTarget / signal.signalClose - 1)
  const horizon = Math.max(4, Number(signal.horizonSessions) || 12)
  const velocity = (expectedUpside - 2 * feeRate) / horizon
  const regimeBoost = signal.leg === 'vol-breakout' ? 1.15 : 1.0
  return Math.max(0, velocity * regimeBoost)
}

export function summarizePortfolioRotation({
  prepared,
  closedTrades,
  openPositions,
  equityCurve,
  maxDrawdown,
  avgUtilization,
  maxSlots,
  feeRate,
}) {
  const finalEquity = equityCurve.at(-1)?.equity ?? 1
  const totalNetReturn = finalEquity - 1
  const benchmarkReturn = (equityCurve.at(-1)?.benchmarkEquity ?? 1) - 1

  const startMs = Date.parse(equityCurve[0]?.date)
  const endMs = Date.parse(equityCurve.at(-1)?.date)
  const years =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? (endMs - startMs) / (365.25 * 86400_000) : 1
  const cagr = years > 0 && finalEquity > 0 ? Math.pow(finalEquity, 1 / years) - 1 : 0

  const dailyReturns = []
  for (let i = 1; i < equityCurve.length; i += 1) {
    const prev = equityCurve[i - 1].equity
    if (prev > 0) dailyReturns.push(equityCurve[i].equity / prev - 1)
  }
  const meanDaily = dailyReturns.length ? dailyReturns.reduce((s, x) => s + x, 0) / dailyReturns.length : 0
  const varDaily =
    dailyReturns.length > 1
      ? dailyReturns.reduce((s, x) => s + (x - meanDaily) * (x - meanDaily), 0) / (dailyReturns.length - 1)
      : 0
  const sessionsPerYear = years > 0 ? equityCurve.length / years : 252
  const annualVol = Math.sqrt(varDaily * sessionsPerYear)
  const sharpe = annualVol > 1e-6 ? (meanDaily * sessionsPerYear) / annualVol : 0

  const wins = closedTrades.filter((t) => t.rawNetReturn > 0)
  const losses = closedTrades.filter((t) => t.rawNetReturn <= 0)
  const winSum = wins.reduce((s, t) => s + t.portfolioContribution, 0)
  const lossAbs = Math.abs(losses.reduce((s, t) => s + t.portfolioContribution, 0))

  const bySymbol = new Map(
    prepared.map((a) => [
      a.symbol,
      {
        symbol: a.symbol,
        label: a.label,
        market: a.market,
        trades: 0,
        wins: 0,
        netContribution: 0,
        active: openPositions.has(a.symbol),
      },
    ]),
  )
  for (const t of closedTrades) {
    const rec = bySymbol.get(t.symbol)
    if (!rec) continue
    rec.trades += 1
    if (t.rawNetReturn > 0) rec.wins += 1
    rec.netContribution += t.portfolioContribution
  }
  const attribution = [...bySymbol.values()].sort((a, b) => b.netContribution - a.netContribution)

  const activeHoldings = []
  for (const asset of prepared) {
    const pos = openPositions.get(asset.symbol)
    if (!pos) continue
    activeHoldings.push({
      symbol: asset.symbol,
      label: asset.label,
      legLabel: pos.legLabel,
      entryDate: pos.entryDate,
      entryPrice: pos.entryPrice,
      markPrice: asset.lastClose,
      slotWeight: pos.slotWeight,
      unrealizedReturn: asset.lastClose / pos.entryPrice - 1 - feeRate,
    })
  }

  return {
    status: 'ready',
    claimClass: 'scenario-proxy',
    executionAuthority: 'none',
    assetCount: prepared.length,
    maxSlots,
    feeRate,
    startDate: equityCurve[0]?.date ?? '',
    endDate: equityCurve.at(-1)?.date ?? '',
    years,
    summary: {
      totalNetReturn,
      benchmarkReturn,
      cagr,
      annualVol,
      sharpe,
      calmar: maxDrawdown < -1e-4 ? cagr / Math.abs(maxDrawdown) : null,
      maxDrawdown,
      avgUtilization,
      closedCount: closedTrades.length,
      winRate: closedTrades.length ? wins.length / closedTrades.length : null,
      profitFactor: lossAbs > 0 ? winSum / lossAbs : wins.length > 0 ? Infinity : null,
      activeCount: activeHoldings.length,
    },
    equityCurve,
    attribution,
    activeHoldings,
    recentTrades: closedTrades.slice(-32).reverse(),
  }
}

export function emptyPortfolioResult() {
  return {
    status: 'empty',
    claimClass: 'scenario-proxy',
    executionAuthority: 'none',
    assetCount: 0,
    maxSlots: 0,
    feeRate: 0.001,
    startDate: '',
    endDate: '',
    years: 0,
    summary: {
      totalNetReturn: 0,
      benchmarkReturn: 0,
      cagr: 0,
      annualVol: 0,
      sharpe: 0,
      calmar: null,
      maxDrawdown: 0,
      avgUtilization: 0,
      closedCount: 0,
      winRate: null,
      profitFactor: null,
      activeCount: 0,
    },
    equityCurve: [],
    attribution: [],
    activeHoldings: [],
    recentTrades: [],
  }
}
