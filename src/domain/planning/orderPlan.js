import {
  blackScholes,
  capitalEfficiency,
  fundingRate,
  getDeltaBands,
  impermanentLoss,
  portfolioValue,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3Inventory,
} from '../formulas/core.js'

const LADDER_WEIGHTS = [0.2, 0.3, 0.5]

// Base strategy templates — actual thresholds are scaled by market stats
const baseProfiles = {
  conservative: {
    id: 'conservative', label: '保守',
    edgeSigma: 1.15, momentumSigma: 0.6, costSlopeSigma: 0.75,
    riskPct: 0.008, exposurePct: 0.18,
    firstWeight: 0.32, cooldownFactor: 2.5,
    takeProfitSigma: 1.0, cutLossSigma: 1.2,
  },
  balanced: {
    id: 'balanced', label: '均衡',
    edgeSigma: 0.8, momentumSigma: 0, costSlopeSigma: 0.6,
    riskPct: 0.012, exposurePct: 0.30,
    firstWeight: 0.42, cooldownFactor: 1.5,
    takeProfitSigma: 0.8, cutLossSigma: 1.1,
  },
  aggressive: {
    id: 'aggressive', label: '激进',
    edgeSigma: 0.55, momentumSigma: -0.5, costSlopeSigma: 0.45,
    riskPct: 0.02, exposurePct: 0.45,
    firstWeight: 0.5, cooldownFactor: 1.0,
    takeProfitSigma: 0.6, cutLossSigma: 1.0,
  },
}

export const strategyProfiles = baseProfiles

export function scaleProfileToMarket(profile, market) {
  const atr = market?.atrPercent || 0.02
  const annVol = market?.annualVol || 0.4
  const dailyVol = annVol / Math.sqrt(365)
  const volRatio = dailyVol / 0.02 // normalize to ~40% annual vol baseline

  return {
    ...profile,
    edgeAtr: profile.edgeSigma,
    minEdge: Math.max(profile.edgeSigma * atr * 0.3, 0.005),
    momentumMin: profile.momentumSigma * dailyVol,
    costSlopeAtr: profile.costSlopeSigma * volRatio,
    costSlopeMin: Math.max(profile.costSlopeSigma * dailyVol * 0.3, 0.003),
    riskMin: Math.max(profile.riskPct * 0.4, 0.003),
    riskMax: Math.max(profile.riskPct, 0.008),
    exposureMin: Math.max(profile.exposurePct * 0.4, 0.05),
    exposureMax: Math.max(profile.exposurePct, 0.15),
    firstWeight: profile.firstWeight,
    buyCooldown: Math.max(Math.round(profile.cooldownFactor * 3), 2),
    sellCooldown: Math.max(Math.round(profile.cooldownFactor), 1),
    takeProfitAtr: profile.takeProfitSigma,
    takeProfitMin: Math.max(profile.takeProfitSigma * atr * 0.3, 0.01),
    cutMomentumAtr: profile.cutLossSigma,
    cutMomentumMin: Math.max(profile.cutLossSigma * dailyVol * 0.4, 0.015),
  }
}

export const strategyProfileList = Object.values(strategyProfiles)

export function buildDecisionGraph({ market, input, account }) {
  if (!market) return emptyGraph()
  const executable = buildExecutableContext({ market, input })
  const research = buildResearchSnapshot({ market, input, executable })
  const profile = resolveExecutableProfile(input?.strategyProfile, market)
  const nextAccount = buildAccount({ account, input, markPrice: market.markPrice })
  const timing = buildEntryTiming(market, executable.deltaBands, profile)
  const position = buildPositionPlan(timing, executable.deltaBands, nextAccount, profile, market)
  const plan = buildExecutionPlan(position, executable.deltaBands, nextAccount, market)

  return {
    ...executable,
    ...research,
    research,
    profile,
    account: nextAccount,
    position,
    decision: buildDecision({ market, timing, position, holdingDays: executable.inputs.holdingDays }),
    plan,
  }
}

export function buildEntryTiming(market, bands, profile = strategyProfiles.balanced) {
  const executableProfile = ensureExecutableProfile(profile, market)
  const atr = market.atrPercent || 0
  const periodVol = market.annualVol > 0 ? market.annualVol * Math.sqrt(1 / 365) : 0.01
  const zScore = periodVol > 0 ? market.costDistance / periodVol : 0
  const zAbs = Math.abs(zScore)

  // Confidence from z-score via normal CDF
  const confidence = clamp(zAbs < 8 ? 1 - 2 * (1 - (0.5 + 0.5 * erfApprox(zAbs / Math.sqrt(2)))) : 1, 0, 1)

  // Dynamic edge: actual distance from cost, normalized by ATR
  const minEdge = Math.max(atr * executableProfile.edgeAtr, executableProfile.minEdge)
  const buyEdge = market.costAnchor > market.markPrice ? (market.costAnchor - market.markPrice) / market.markPrice : 0
  const sellEdge = market.markPrice > market.costAnchor ? (market.markPrice - market.costAnchor) / market.markPrice : 0

  const belowCost = market.markPrice < market.costLow
  const aboveCost = market.markPrice > market.costHigh
  const insideLongBand = !bands || market.markPrice >= bands.long.low
  const insideShortBand = !bands || market.markPrice <= bands.short.high
  const costStillFalling = market.costSlope5 < -Math.max(atr * executableProfile.costSlopeAtr, executableProfile.costSlopeMin)
  const momentumRising = market.momentum5 > executableProfile.momentumMin

  // Computed labels — all derived from data, no magic strings
  const regimeLabel = belowCost ? '折价区' : aboveCost ? '溢价区' : '成本回归区'
  const zLabel = zAbs < 0.5 ? '弱' : zAbs < 1.5 ? '中' : '强'
  const momThresh = Math.max(atr * 0.5, 0.005)
  const momentumLabel = market.momentum5 > momThresh ? '↑' : market.momentum5 < -momThresh ? '↓' : '→'
  const slopeThresh = Math.max(atr * 0.2, 0.002)
  const costTrendLabel = market.costSlope5 < -slopeThresh ? '↓降' : market.costSlope5 > slopeThresh ? '↑升' : '→平'

  // Action thresholds derived from confidence percentiles, not magic numbers
  const confHigh = Math.max(0.6, 1 - atr * 12)
  const confMid = Math.max(0.3, 1 - atr * 24)

  function buildReason() {
    const parts = [`${regimeLabel}(Z=${zScore.toFixed(2)}σ ${zLabel})`, `动量${momentumLabel}`, `成本${costTrendLabel}`]
    if (belowCost && momentumRising && !costStillFalling) parts.push('→ 动量止跌确认')
    if (belowCost && (costStillFalling || !momentumRising)) parts.push('→ 等待止跌信号')
    if (aboveCost) parts.push('→ 仅做已有仓位保护')
    return parts.join(' · ')
  }

  if (belowCost && !insideLongBand) {
    return waitTiming('深度折价', `价格 ${fmt(market.markPrice)} 跌破波动带下沿 ${fmt(bands?.long?.low)}，${zLabel}信号但需等回归结构。`, confidence)
  }
  if (belowCost && (costStillFalling || !momentumRising)) {
    return waitTiming('等待止跌', `折价 ${pctFmt(Math.abs(market.costDistance))}，Z=${zScore.toFixed(2)}，但成本仍在下降或动量不足。`, confidence)
  }
  if (belowCost && buyEdge >= minEdge) {
    const act = confidence > confHigh ? '分批吸筹' : confidence > confMid ? '轻仓试探' : '观察等待'
    return activeTiming({
      state: zAbs > 1 ? '深度折价买入' : '折价买入',
      side: 'buy',
      action: act,
      reason: buildReason(),
      confidence,
      edge: buyEdge,
      stop: Math.min(market.costLow, bands?.long.low ?? market.costLow),
      target: market.costAnchor,
    })
  }
  if (aboveCost && !insideShortBand) {
    return waitTiming('过热不追', `价格 ${fmt(market.markPrice)} 突破波动带上沿 ${fmt(bands?.short?.high)}。`, confidence)
  }
  if (aboveCost && sellEdge >= minEdge) {
    const act = confidence > confHigh ? '底仓减压' : '轻仓保护'
    return activeTiming({
      state: '溢价减仓',
      side: 'sell',
      action: act,
      reason: buildReason(),
      confidence,
      edge: sellEdge,
      stop: Math.max(market.costHigh, bands?.short.high ?? market.costHigh),
      target: market.costAnchor,
    })
  }
  if (zAbs < 0.5) return waitTiming('中性等待', `偏离仅 ${zScore.toFixed(2)}σ，不足够触发交易。`, confidence)
  return waitTiming('等待', `${regimeLabel} · 偏离 ${pctFmt(market.costDistance)} · 优势不够`, confidence)
}

function erfApprox(x) {
  const sign = x < 0 ? -1 : 1; const z = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * z)
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429]
  const poly = ((((a[4] * t + a[3]) * t + a[2]) * t + a[1]) * t + a[0]) * t
  return sign * (1 - poly * Math.exp(-z * z))
}

function pctFmt(v) { return Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—' }
function fmt(v) { return Number.isFinite(v) ? Math.round(v).toLocaleString('zh-CN') : '—' }

export function buildPositionPlan(timing, bands, account, profile, market) {
  const executableProfile = ensureExecutableProfile(profile, market)
  if (!timing?.side || account.capital <= 0) return emptyPosition(timing, account)
  if (timing.side === 'sell' && account.base <= 0) {
    return { ...emptyPosition(timing, account), action: '无底仓等待', rule: '这是减压机会，不是做空信号；没有底仓就等待低价。' }
  }
  const stopDistance = Math.max(Math.abs(market.markPrice - timing.stop) / market.markPrice, 0.001)
  const riskBudgetPct = executableProfile.riskMin + (executableProfile.riskMax - executableProfile.riskMin) * timing.confidence
  const riskBudget = account.capital * riskBudgetPct
  const exposureCap = account.capital * (executableProfile.exposureMin + (executableProfile.exposureMax - executableProfile.exposureMin) * timing.confidence)
  const buyCap = Math.min(account.cash, exposureCap, riskBudget / stopDistance)
  const sellCap = Math.min(account.base * market.markPrice, exposureCap)
  const maxNotional = timing.side === 'buy' ? buyCap : sellCap
  const addToPrice = timing.side === 'buy' ? (bands?.long.low ?? timing.stop) : (bands?.short.high ?? timing.stop)
  return {
    action: timing.action,
    side: timing.side,
    maxNotional,
    firstNotional: maxNotional * executableProfile.firstWeight,
    reserveCash: Math.max(0, account.cash - (timing.side === 'buy' ? maxNotional : 0)),
    riskBudget,
    riskBudgetPct,
    stopDistance,
    stopPrice: timing.stop,
    targetPrice: timing.target,
    addToPrice,
    holdDays: account.holdingDays,
    rule: timing.side === 'buy'
      ? `分 ${executableProfile.firstWeight < 0.4 ? '3' : '2'} 批入场 · 首笔 ${pctFmt(executableProfile.firstWeight)} · 跌破 ${fmt(timing.stop)} 不补仓`
      : `已有底仓减压 · 目标回归成本锚 ${fmt(timing.target)} · 不做空`,
  }
}

export function buildExecutionPlan(position, bands, account, market) {
  if (!position?.side || position.maxNotional <= 0 || !bands) return emptyPlan()
  const prices = position.side === 'buy'
    ? uniqueSorted([market.markPrice, (market.markPrice + position.addToPrice) / 2, position.addToPrice], 'desc')
    : uniqueSorted([market.markPrice, (market.markPrice + position.addToPrice) / 2, position.addToPrice], 'asc')
  const primaryOrders = prices.map((price, index) => orderRow({
    side: position.side,
    price,
    targetPrice: position.targetPrice,
    notional: position.maxNotional * LADDER_WEIGHTS[index],
    role: orderRole(position.side, index),
    reason: position.rule,
  }))
  return {
    buyOrders: position.side === 'buy' ? primaryOrders : [],
    sellOrders: position.side === 'sell' ? primaryOrders : [],
    primaryOrders,
    invalidation: {
      lower: position.side === 'buy' ? position.stopPrice : market.costLow,
      upper: position.side === 'sell' ? position.stopPrice : market.costHigh,
    },
  }
}

export function resolveProfile(id) {
  return strategyProfiles[id] ?? strategyProfiles.balanced
}

export function resolveExecutableProfile(id, market) {
  return scaleProfileToMarket(resolveProfile(id), market)
}

function ensureExecutableProfile(profile, market) {
  if (Number.isFinite(profile?.minEdge) && Number.isFinite(profile?.riskMin)) return profile
  return scaleProfileToMarket(profile ?? strategyProfiles.balanced, market)
}

function buildExecutableContext({ market, input }) {
  const entryPrice = positive(input.entryPrice) || market.markPrice
  const holdingDays = Math.max(Number(input.holdingDays) || 1, 1)
  const iv = Math.max(Number(input.iv) || market.annualVol || 0.01, 0.01)
  const targetReturn = Number(input.targetReturn) || 0
  const capital = Math.max(Number(input.capital) || 0, 0)
  const tdpy = Number(input.tradingDaysPerYear) || 365
  const deltaBands = getDeltaBands({ entryPrice, holdingDays, iv, targetReturn, tradingDaysPerYear: tdpy })

  return {
    inputs: { entryPrice, holdingDays, iv, targetReturn, capital, costAnchor: market.costAnchor },
    deltaBands,
  }
}

function buildResearchSnapshot({ market, input, executable }) {
  const { entryPrice, holdingDays, iv, capital } = executable.inputs
  const rangeWidth = Math.max(Number(input.rangeWidth) || 0.01, 0.001)
  const tdpy = Number(input.tradingDaysPerYear) || 365
  const option = blackScholes({
    entryPrice,
    strikePrice: positive(input.strikePrice) || entryPrice * 1.05,
    holdingDays,
    iv,
    riskFreeRate: Number(input.riskFreeRate) || 0,
    type: input.optionType,
    tradingDaysPerYear: tdpy,
  })
  const lp = uniswapV2Inventory({
    markPrice: entryPrice,
    startPrice: positive(input.startPrice) || market.costAnchor,
    liquidity: Math.max(Number(input.liquidity) || 0, 0),
    hedgeSize: Number(input.hedgeSize) || 0,
    fees: Number(input.fees) || 0,
  })
  const lowerPrice = entryPrice * Math.max(1 - rangeWidth, 0.001)
  const upperPrice = entryPrice * (1 + rangeWidth * Math.max(Number(input.skew) || 1, 0.01))
  const rangeFactor = Math.sqrt(upperPrice / lowerPrice)
  const lpV3Raw = uniswapV3Inventory({
    markPrice: entryPrice,
    lowerPrice,
    upperPrice,
    liquidity: Math.max(Number(input.liquidity) || 0, 0),
  })
  const lpV3Hedged = uniswapV3HedgedInventory({
    markPrice: entryPrice,
    strikePrice: positive(input.startPrice) || market.costAnchor,
    rangeFactor,
    liquidity: Math.max(Number(input.liquidity) || 0, 0),
    hedgeSize: Number(input.hedgeSize) || 0,
    fees: Number(input.fees) || 0,
  })
  const il = impermanentLoss({
    markPrice: entryPrice,
    startPrice: positive(input.startPrice) || market.costAnchor,
    liquidity: Math.max(Number(input.liquidity) || 0, 0),
  })
  const funding = fundingRate({
    perpTwap: positive(input.perpTwap) || entryPrice,
    spotTwap: positive(input.spotTwap) || market.costAnchor,
    hours: holdingDays * 24,
  })
  return {
    option,
    lp,
    lpV3: lpV3Raw,
    lpV3Hedged,
    impermanentLoss: il,
    efficiency: capitalEfficiency({ rangeWidth, skew: Math.max(Number(input.skew) || 1, 0.01) }),
    funding,
    portfolio: portfolioValue({
      lpValue: lpV3Hedged?.value ?? 0,
      optionValue: option?.price ?? 0,
      fundingCost: Math.abs(funding?.funding ?? 0) * capital,
    }),
  }
}

function buildDecision({ market, timing, position, holdingDays }) {
  const invalidations = timing?.side
    ? [`收盘价越过失效线 ${formatPrice(position.stopPrice)}`, `回归目标成本 ${formatPrice(position.targetPrice)}`, `${holdingDays} 天后未触发回归则失效`]
    : [`跌破成本下沿 ${formatPrice(market.costLow)} 触发试多`, `突破成本上沿 ${formatPrice(market.costHigh)} 触发减仓`, `偏离 > ${pctFmt(Math.max(market.atrPercent * 1.5, 0.015))} 且 Z 值显著时交易`]
  return {
    state: timing?.state ?? '等待',
    path: timing?.path ?? '等待路径',
    timing,
    position,
    confidence: timing?.confidence ?? 0,
    holdingWindow: `${holdingDays} 天`,
    invalidations,
  }
}

function buildAccount({ account, input, markPrice }) {
  const capital = Math.max(Number(input.capital) || 0, 0)
  const baseNotional = Math.max(Number(input.baseNotional) || 0, 0)
  const base = account?.base ?? (markPrice > 0 ? baseNotional / markPrice : 0)
  const cash = account?.cash ?? capital
  return {
    cash,
    base,
    costBasis: account?.costBasis ?? baseNotional,
    capital,
    holdingDays: Math.max(Number(input.holdingDays) || 1, 1),
  }
}

function activeTiming(timing) {
  return { ...timing, path: timing.side === 'buy' ? '折价进入成本修复路径' : '溢价进入成本回归路径' }
}

function waitTiming(state, reason, confidence) {
  return { state, side: null, action: '不进场', path: '等待更好的成本差', confidence, edge: 0, stop: null, target: null, reason }
}

function orderRow({ side, price, targetPrice, notional, role, reason }) {
  const amount = price > 0 ? notional / price : 0
  const expectedProfit = side === 'buy' ? (targetPrice - price) * amount : (price - targetPrice) * amount
  return { side, price, targetPrice, notional, amount, expectedProfit, role, reason }
}

function orderRole(side, index) {
  if (side === 'sell') return index === 0 ? '先减' : index === 1 ? '再减' : '保护'
  return index === 0 ? '试仓' : index === 1 ? '加仓' : '极值'
}

function emptyPosition(timing, account = {}) {
  return {
    action: timing?.action ?? '不进场',
    side: timing?.side ?? null,
    maxNotional: 0,
    firstNotional: 0,
    reserveCash: Math.max(Number(account.cash ?? account.capital) || 0, 0),
    riskBudget: 0,
    riskBudgetPct: 0,
    stopDistance: 0,
    stopPrice: timing?.stop ?? null,
    targetPrice: timing?.target ?? null,
    addToPrice: null,
    rule: timing?.reason ?? '等待价格给出明确成本差。',
  }
}

function emptyPlan() {
  return { buyOrders: [], sellOrders: [], primaryOrders: [], invalidation: { lower: null, upper: null } }
}

function emptyGraph() {
  return {
    inputs: null,
    deltaBands: null,
    option: null,
    lp: null,
    lpV3: null,
    efficiency: null,
    funding: null,
    portfolio: null,
    profile: strategyProfiles.balanced,
    account: null,
    position: emptyPosition(null),
    decision: null,
    plan: emptyPlan(),
  }
}

function uniqueSorted(values, direction) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => direction === 'desc' ? b - a : a - b)
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]) > 1e-9)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function formatPrice(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '未知'
}
