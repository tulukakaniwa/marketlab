const SQRT_TWO_PI = Math.sqrt(2 * Math.PI)

export function normalPdf(x) {
  if (!Number.isFinite(x)) return 0
  return Math.exp(-(x * x) / 2) / SQRT_TWO_PI
}

export function normalCdf(x) {
  if (x === Infinity) return 1
  if (x === -Infinity) return 0
  if (!Number.isFinite(x)) return null
  const sign = x < 0 ? -1 : 1
  const z = Math.abs(x) / Math.sqrt(2)
  const t = 1 / (1 + 0.3275911 * z)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const erf = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z))
  return 0.5 * (1 + sign * erf)
}

export function getDeltaBands({ entryPrice, holdingDays, iv, targetReturn, z = 1, tradingDaysPerYear = 365 }) {
  if (![entryPrice, holdingDays, iv, targetReturn, z, tradingDaysPerYear].every(Number.isFinite)) return null
  if (entryPrice <= 0 || holdingDays <= 0 || iv <= 0 || z <= 0 || tradingDaysPerYear <= 0) return null

  const wave = iv * Math.sqrt(holdingDays / (tradingDaysPerYear * 2 * Math.PI))
  if (!Number.isFinite(wave) || wave >= 1) return null

  const rawRatio = Math.pow(1 + wave, 2) / Math.pow(1 - wave, 2)
  const longRatio = rawRatio * z
  const longCost = entryPrice * Math.pow(targetReturn * longRatio - targetReturn + 1, 2) / longRatio
  const shortRatio = 1 / longRatio
  const shortCost = entryPrice * Math.pow(targetReturn * shortRatio - targetReturn + 1, 2) / shortRatio

  return {
    wave,
    longRatio,
    long: {
      high: longCost * longRatio,
      cost: longCost,
      low: longCost / longRatio,
    },
    short: {
      high: shortCost / shortRatio,
      cost: shortCost,
      low: shortCost * shortRatio,
    },
  }
}

export function blackScholes({ entryPrice, strikePrice, holdingDays, iv, riskFreeRate, type, tradingDaysPerYear = 365 }) {
  const time = holdingDays / tradingDaysPerYear
  if (![entryPrice, strikePrice, holdingDays, iv, riskFreeRate].every(Number.isFinite)) return null
  if (entryPrice <= 0 || strikePrice <= 0 || time <= 0 || iv <= 0) return null

  const sqrtT = Math.sqrt(time)
  const d1 = (Math.log(entryPrice / strikePrice) + (riskFreeRate + (iv * iv) / 2) * time) / (iv * sqrtT)
  const d2 = d1 - iv * sqrtT
  const nd1 = normalCdf(d1)
  const nd2 = normalCdf(d2)
  const discountStrike = strikePrice * Math.exp(-riskFreeRate * time)
  const callPrice = entryPrice * nd1 - discountStrike * nd2
  const putPrice = discountStrike * normalCdf(-d2) - entryPrice * normalCdf(-d1)
  const isPut = type === 'put'

  return {
    d1,
    d2,
    price: Math.max(0, isPut ? putPrice : callPrice),
    delta: isPut ? nd1 - 1 : nd1,
    gamma: normalPdf(d1) / (entryPrice * iv * sqrtT),
    theta:
      -(entryPrice * normalPdf(d1) * iv) / (2 * sqrtT) -
      riskFreeRate * strikePrice * Math.exp(-riskFreeRate * time) * (isPut ? -normalCdf(-d2) : nd2),
    vega: entryPrice * normalPdf(d1) * sqrtT / 100,
  }
}

export function vixFix({ highestClose, low }) {
  if (![highestClose, low].every(Number.isFinite) || highestClose <= 0) return null
  return Math.max(0, (highestClose - low) / highestClose)
}

export function uniswapV2Inventory({ markPrice, startPrice, liquidity, hedgeSize, fees }) {
  if (![markPrice, startPrice, liquidity, hedgeSize, fees].every(Number.isFinite)) return null
  if (markPrice <= 0 || startPrice <= 0 || liquidity < 0) return null
  const unhedged = 2 * liquidity * (Math.sqrt(markPrice) - Math.sqrt(startPrice)) + fees
  const hedge = hedgeSize * (markPrice - startPrice)
  return {
    value: unhedged - hedge,
    inventoryDelta: liquidity / Math.sqrt(markPrice) - hedgeSize,
    neutralHedgeAtStart: liquidity / Math.sqrt(startPrice),
  }
}

export function uniswapV3Inventory({ markPrice, lowerPrice, upperPrice, liquidity }) {
  if (![markPrice, lowerPrice, upperPrice, liquidity].every(Number.isFinite)) return null
  if (markPrice <= 0 || lowerPrice <= 0 || upperPrice <= lowerPrice || liquidity < 0) return null

  const sqrtP = Math.sqrt(markPrice)
  const sqrtLower = Math.sqrt(lowerPrice)
  const sqrtUpper = Math.sqrt(upperPrice)
  let token0 = 0
  let token1 = 0

  if (markPrice <= lowerPrice) {
    token0 = liquidity * (1 / sqrtLower - 1 / sqrtUpper)
  } else if (markPrice >= upperPrice) {
    token1 = liquidity * (sqrtUpper - sqrtLower)
  } else {
    token0 = liquidity * (1 / sqrtP - 1 / sqrtUpper)
    token1 = liquidity * (sqrtP - sqrtLower)
  }

  return {
    token0,
    token1,
    value: token0 * markPrice + token1,
    inventoryDelta: token0,
  }
}

export function capitalEfficiency({ rangeWidth, skew }) {
  if (![rangeWidth, skew].every(Number.isFinite) || rangeWidth <= 0 || rangeWidth >= 1 || skew < 0) return null
  const lower = 1 - rangeWidth
  const upper = 1 + skew * rangeWidth
  return {
    lower,
    upper,
    efficiency: 1 / (1 - Math.pow(lower / upper, 0.25)),
  }
}

export function fundingRate({ perpTwap, spotTwap, hours }) {
  if (![perpTwap, spotTwap, hours].every(Number.isFinite) || spotTwap <= 0 || hours < 0) return null
  const ratio = perpTwap / spotTwap - 1
  return {
    ratio,
    funding: ratio * (hours / 24),
  }
}

export function portfolioValue({ lpValue, optionValue, fundingCost }) {
  if (![lpValue, optionValue, fundingCost].every(Number.isFinite)) return null
  return lpValue + optionValue - fundingCost
}

export function uniswapV3Payoff(price, strikePrice, rangeFactor) {
  if (![price, strikePrice, rangeFactor].every(Number.isFinite)) return null
  if (price <= 0 || strikePrice <= 0 || rangeFactor <= 1) return null
  const lower = strikePrice / rangeFactor
  const upper = strikePrice * rangeFactor
  if (price <= lower) return { value: price, zone: 'token0' }
  if (price >= upper) return { value: strikePrice, zone: 'token1' }
  return {
    value: (2 * Math.sqrt(price * strikePrice * rangeFactor) - price - strikePrice) / (rangeFactor - 1),
    zone: 'range',
  }
}

export function uniswapV3HedgedInventory({ markPrice, strikePrice, rangeFactor, liquidity, hedgeSize, fees }) {
  if (![markPrice, strikePrice, rangeFactor, liquidity, hedgeSize, fees].every(Number.isFinite)) return null
  if (markPrice <= 0 || strikePrice <= 0 || rangeFactor <= 1 || liquidity < 0) return null

  const currentPayoff = uniswapV3Payoff(markPrice, strikePrice, rangeFactor)
  const entryPayoff = uniswapV3Payoff(strikePrice, strikePrice, rangeFactor)
  if (!currentPayoff || !entryPayoff) return null

  const lpPnl = liquidity * (currentPayoff.value - entryPayoff.value)
  const hedgePnl = hedgeSize * (markPrice - strikePrice)
  const feeIncome = fees * strikePrice

  return {
    value: lpPnl - hedgePnl + feeIncome,
    lpPnl,
    hedgePnl,
    feeIncome,
    lowerPrice: strikePrice / rangeFactor,
    upperPrice: strikePrice * rangeFactor,
    zone: currentPayoff.zone,
  }
}

export function impermanentLoss({ markPrice, startPrice, liquidity }) {
  if (![markPrice, startPrice, liquidity].every(Number.isFinite)) return null
  if (markPrice <= 0 || startPrice <= 0 || liquidity < 0) return null

  const sqrtMark = Math.sqrt(markPrice)
  const sqrtStart = Math.sqrt(startPrice)
  const lpValue = 2 * liquidity * sqrtMark
  const holdValue = liquidity * sqrtStart + (liquidity / sqrtStart) * markPrice
  const lpEntryValue = 2 * liquidity * sqrtStart

  return {
    lpValue,
    holdValue,
    lpEntryValue,
    impermanentLoss: holdValue > 0 ? (lpValue - holdValue) / holdValue : 0,
    impermanentGain: holdValue > 0 ? -(lpValue - holdValue) / holdValue : 0,
    borrowedLpValue: -lpValue,
    borrowedHoldValue: -holdValue,
  }
}

export function laplaceDensity(x, { mu = 0, lambda = 1, kappa = 1 } = {}) {
  if (!Number.isFinite(x) || lambda <= 0 || kappa <= 0) return null
  const s = x >= mu ? 1 : -1
  const norm = lambda / (kappa + 1 / kappa)
  return norm * Math.exp(-Math.abs(x - mu) * lambda * (s === 1 ? kappa : 1 / kappa))
}

export function logLaplaceDensity(price, { mu = 0, lambda = 1, kappa = 1, lower = null, upper = null } = {}) {
  if (!Number.isFinite(price) || price <= 0) return null
  if (lower !== null && price < lower) return 0
  if (upper !== null && price > upper) return 0
  return laplaceDensity(Math.log(price), { mu, lambda, kappa })
}

export function asianOption({ entryPrice, strikePrice, holdingDays, iv, riskFreeRate = 0, type = 'put', tradingDaysPerYear = 365 }) {
  if (![entryPrice, strikePrice, holdingDays, iv].every(Number.isFinite)) return null
  if (entryPrice <= 0 || strikePrice <= 0 || holdingDays <= 0 || iv <= 0) return null
  const time = holdingDays / tradingDaysPerYear
  const sigmaGeo = iv / Math.sqrt(3)
  const b = 0.5 * (riskFreeRate - (sigmaGeo * sigmaGeo) / 2)
  const sqrtT = Math.sqrt(time)
  const d1 = (Math.log(entryPrice / strikePrice) + (b + (sigmaGeo * sigmaGeo) / 2) * time) / (sigmaGeo * sqrtT)
  const d2 = d1 - sigmaGeo * sqrtT
  const nd1 = normalCdf(d1)
  const nd2 = normalCdf(d2)
  const discountK = strikePrice * Math.exp(-riskFreeRate * time)
  const driftS = entryPrice * Math.exp((b - riskFreeRate) * time)
  const callPrice = driftS * nd1 - discountK * nd2
  const putPrice = discountK * normalCdf(-d2) - driftS * normalCdf(-d1)
  const isPut = type === 'put'
  return {
    sigmaGeo,
    b,
    d1, d2,
    price: Math.max(0, isPut ? putPrice : callPrice),
    delta: isPut ? nd1 - 1 : nd1,
    regularIv: iv,
  }
}

export function ammCurve({ price, invariant = 1, n = 50 }) {
  if (!Number.isFinite(price) || price <= 0 || invariant <= 0) return null
  const L = Math.sqrt(invariant)
  const reserveX0 = L / Math.sqrt(price)
  const reserveY0 = L * Math.sqrt(price)
  const xRange = reserveX0 * 3
  const points = Array.from({ length: n }, (_, i) => {
    const x = (xRange * (i + 1)) / n
    const y = invariant / x
    return { x, y }
  })
  return { points, currentX: reserveX0, currentY: reserveY0, L, invariant, price }
}

export function liquidityFingerprint({ entryPrice, priceGrid, distribution = 'log-laplace', mu, lambda, kappa, lowerFactor = 0.2, upperFactor = 5 }) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  const lower = entryPrice * lowerFactor
  const upper = entryPrice * upperFactor
  const n = priceGrid && priceGrid > 2 ? priceGrid : 60
  const prices = Array.from({ length: n }, (_, i) => lower + (upper - lower) * i / (n - 1))
  const logMu = Math.log(entryPrice)
  const lam = lambda ?? 2
  const kap = kappa ?? 1

  const density = distribution === 'log-laplace'
    ? (p) => logLaplaceDensity(p, { mu: logMu, lambda: lam, kappa: kap, lower, upper })
    : (p) => laplaceDensity(p, { mu: entryPrice, lambda: lam, kappa: kap })

  const values = prices.map((p) => ({ price: p, density: density(p) }))
  const maxDensity = Math.max(...values.map((v) => v.density), 0)
  const total = values.reduce((s, v) => s + v.density, 0)

  const m = 8
  const segments = Array.from({ length: m }, (_, i) => {
    const lo = lower + (upper - lower) * i / m
    const hi = lower + (upper - lower) * (i + 1) / m
    const segPrices = prices.filter((_, j) => {
      const p = lower + (upper - lower) * j / (n - 1)
      return p >= lo && p < hi
    })
    const weight = total > 0 ? segPrices.reduce((s, v) => s + density(v.price), 0) / total : 1 / m
    return { lower: lo, upper: hi, weight }
  })

  return {
    entryPrice, lower, upper, prices: values, maxDensity, segments,
    params: { distribution, mu: logMu, lambda: lam, kappa: kap },
  }
}

/* ── Fusion 1: Cost × Volatility → 偏离强度 ── */
export function deviationScore({ costDistance, annualVol, holdingDays = 1, tradingDaysPerYear = 365 }) {
  if (![costDistance, annualVol, holdingDays].every(Number.isFinite)) return null
  if (annualVol <= 0 || holdingDays <= 0) return null
  const periodVol = annualVol * Math.sqrt(holdingDays / tradingDaysPerYear)
  const z = periodVol > 0 ? costDistance / periodVol : 0
  const phi = normalCdf(Math.abs(z))
  const prob = phi !== null ? Math.max(0, Math.min(1, phi)) : 0.5
  return { z, periodVol, regressionProb: prob, regime: costDistance < 0 ? '折价' : costDistance > 0 ? '溢价' : '平价', strength: Math.abs(z) < 0.5 ? '弱' : Math.abs(z) < 1.5 ? '中' : '强' }
}

/* ── Fusion 2: IL × CE → LP 净效率 ── */
export function netLpEfficiency({ capitalEfficiency, impermanentLoss, feeRate = 0 }) {
  if (![capitalEfficiency, impermanentLoss].every(Number.isFinite)) return null
  if (capitalEfficiency <= 0) return null
  const grossGain = capitalEfficiency - 1
  const netGain = grossGain + impermanentLoss
  const feeBoost = capitalEfficiency * feeRate
  const totalNet = netGain + feeBoost
  return { grossGain, impermanentLoss, feeBoost, totalNet, efficient: totalNet > 0, ce: capitalEfficiency }
}

/* ── Fusion 3: Delta Band × Option Greeks → 风险曲面 ── */
export function riskSurface({ entryPrice, strikePrice, holdingDays, iv, riskFreeRate = 0, bandLow, bandHigh, steps = 40, tradingDaysPerYear = 365 }) {
  if (![entryPrice, strikePrice, holdingDays, iv, bandLow, bandHigh].every(Number.isFinite)) return null
  if (entryPrice <= 0 || holdingDays <= 0 || iv <= 0 || bandLow <= 0 || bandLow >= bandHigh) return null
  const time = holdingDays / tradingDaysPerYear
  const sqrtT = Math.sqrt(time)
  const points = []
  for (let i = 0; i <= steps; i++) {
    const price = bandLow + (bandHigh - bandLow) * i / steps
    const d1 = (Math.log(price / strikePrice) + (riskFreeRate + (iv * iv) / 2) * time) / (iv * sqrtT)
    const d2 = d1 - iv * sqrtT
    const nd1 = normalCdf(d1)
    const nd2 = normalCdf(d2)
    points.push({
      price,
      delta: nd1,
      gamma: normalPdf(d1) / (price * iv * sqrtT),
      theta: -(price * normalPdf(d1) * iv) / (2 * sqrtT) - riskFreeRate * strikePrice * Math.exp(-riskFreeRate * time) * nd2,
    })
  }
  return { points, entryPrice, strikePrice, bandLow, bandHigh }
}

/* ── 二阶: 均值回归半衰期 ── */
export function meanReversionHalfLife({ costDistanceSeries, tradingDaysPerYear = 365 }) {
  if (!Array.isArray(costDistanceSeries) || costDistanceSeries.length < 5) return null
  const valid = costDistanceSeries.filter(Number.isFinite)
  if (valid.length < 5) return null

  // AR(1) coefficient via OLS: x_t = ρ·x_{t-1} + ε
  let sumXY = 0, sumX2 = 0
  const x = valid
  for (let i = 1; i < x.length; i++) {
    sumXY += x[i] * x[i - 1]
    sumX2 += x[i - 1] * x[i - 1]
  }
  const rho = sumX2 > 0 ? Math.max(-0.99, Math.min(0.99, sumXY / sumX2)) : 0
  const theta = -Math.log(Math.abs(rho))
  const halfLife = rho !== 0 && Math.abs(rho) < 1 ? Math.log(2) / theta : Infinity
  const halfLifeDays = Number.isFinite(halfLife) ? halfLife : null

  // Speed assessment in prime-period terms
  const tradingDays = tradingDaysPerYear || 365
  const dayFrac = tradingDays / 365
  const speed = halfLifeDays !== null
    ? halfLifeDays < 5 * dayFrac ? '极快' : halfLifeDays < 15 * dayFrac ? '快' : halfLifeDays < 45 * dayFrac ? '中' : halfLifeDays < 90 * dayFrac ? '慢' : '极慢'
    : '无回归'

  return { rho, theta, halfLifeDays, speed, periodNote: `基于 ${tradingDaysPerYear} 日年基，半衰 ${halfLifeDays !== null ? Math.round(halfLifeDays) : '∞'} 天` }
}

/* ── 二阶: Gamma PnL / 凸性收益 ── */
export function gammaPnl({ gamma, priceChange, positionSize = 1 }) {
  if (![gamma, priceChange, positionSize].every(Number.isFinite)) return null
  const dollarGamma = gamma * positionSize
  const pnl = 0.5 * dollarGamma * priceChange * priceChange
  const dailyEstimate = pnl // per period given the price change
  return { dollarGamma, priceChange, gammaPnl: pnl, dailyEstimate, convexityNote: gamma > 0 ? '多头凸性 · 波动有利' : '空头凸性 · 波动不利' }
}

/* ── 二阶: 波动率置信区间 ── */
export function volConfidence({ annualVol, sampleSize = 60, confidenceLevel = 0.68 }) {
  if (![annualVol, sampleSize].every(Number.isFinite)) return null
  if (annualVol <= 0 || sampleSize < 5) return null

  // Standard error of volatility estimate: σ / √(2n)
  const se = annualVol / Math.sqrt(2 * sampleSize)
  // Confidence interval using normal approx (for large n, χ² → normal)
  const z = confidenceLevel === 0.95 ? 1.96 : confidenceLevel === 0.68 ? 1.0 : 1.65
  const lower = Math.max(0, annualVol - z * se)
  const upper = annualVol + z * se
  const relativeUncertainty = se / annualVol

  // Quality assessment
  const seBaseline = 1 / Math.sqrt(2 * sampleSize)
  const quality = relativeUncertainty < seBaseline * 2 ? '高精度' : relativeUncertainty < seBaseline * 4 ? '中精度' : relativeUncertainty < seBaseline * 8 ? '低精度' : '不可靠'

  return { annualVol, se, lower, upper, relativeUncertainty, quality, sampleSize, note: `基于 ${sampleSize} 样本，真实波动率在 [${(lower * 100).toFixed(1)}%, ${(upper * 100).toFixed(1)}%] 之间（${(confidenceLevel * 100).toFixed(0)}% 置信）` }
}

/* ── Fusion 4: Funding × Cost → 持仓净收益 ── */
export function netCarry({ costDistance, fundingRate, holdingDays = 1, tradingDaysPerYear = 365 }) {
  if (![costDistance, fundingRate, holdingDays].every(Number.isFinite)) return null
  const fundingCost = Math.abs(fundingRate) * (holdingDays / tradingDaysPerYear)
  const netReturn = Math.abs(costDistance) - fundingCost
  const breakEven = fundingCost
  return { costDistance, fundingCost, netReturn, breakEven, viable: netReturn > 0, requiredReturn: breakEven + 0.01 }
}
