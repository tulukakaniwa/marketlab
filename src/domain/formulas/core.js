export { normalCdf, normalPdf, inverseNormalCdf, integrateTrapezoid } from './probability.js'
export { asianOption, bachelierOption, blackScholes, getDeltaBands, riskSurface } from './options.js'
export { buildOptionPortfolio, optionLegsFromTemplate, normalizeOptionLegs } from './optionPortfolio.js'
export {
  hedgedLpPortfolioCurve,
  impermanentLoss,
  portfolioValue,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3Inventory,
  uniswapV3Payoff,
} from './lp.js'
export { coveredCallFit, laplaceDensity, liquidityFingerprint, logLaplaceDensity } from './liquidity.js'
export { ammCurve, ammLambertCurve, lambertW, numoenSnapshot } from './amm.js'

import { normalCdf } from './probability.js'

export function vixFix({ highestClose, low }) {
  if (![highestClose, low].every(Number.isFinite) || highestClose <= 0) return null
  return Math.max(0, (highestClose - low) / highestClose)
}

export function capitalEfficiency({ rangeWidth, skew }) {
  if (![rangeWidth, skew].every(Number.isFinite) || rangeWidth <= 0 || rangeWidth >= 1 || skew < 0) return null
  const lower = 1 - rangeWidth
  const upper = 1 + skew * rangeWidth
  return {
    lower,
    upper,
    rangeRatio: lower / upper,
    efficiency: 1 / (1 - Math.pow(lower / upper, 0.25)),
    frontierSlope: Math.abs(
      (-skew - 1) /
      (
        4 *
        Math.pow(Math.pow(upper, 0.25) - Math.pow(lower, 0.25), 2) *
        Math.pow(lower, 0.75) *
        Math.pow(upper, 0.75)
      ),
    ),
  }
}

export function fundingRate({ perpTwap, spotTwap, hours }) {
  if (![perpTwap, spotTwap, hours].every(Number.isFinite) || spotTwap <= 0 || hours < 0) return null
  const ratio = perpTwap / spotTwap - 1
  return {
    ratio,
    funding: ratio * (hours / 24),
    status: 'research-only',
  }
}

export function deviationScore({ costDistance, annualVol, holdingDays = 1, tradingDaysPerYear = 365 }) {
  if (![costDistance, annualVol, holdingDays].every(Number.isFinite)) return null
  if (annualVol <= 0 || holdingDays <= 0) return null
  const periodVol = annualVol * Math.sqrt(holdingDays / tradingDaysPerYear)
  const z = periodVol > 0 ? costDistance / periodVol : 0
  const phi = normalCdf(Math.abs(z))
  const prob = phi !== null ? Math.max(0, Math.min(1, phi)) : 0.5
  return { z, periodVol, regressionProb: prob, regime: costDistance < 0 ? '折价' : costDistance > 0 ? '溢价' : '平价', strength: Math.abs(z) < 0.5 ? '弱' : Math.abs(z) < 1.5 ? '中' : '强' }
}

export function netLpEfficiency({ capitalEfficiency, impermanentLoss, feeRate = 0 }) {
  if (![capitalEfficiency, impermanentLoss].every(Number.isFinite)) return null
  if (capitalEfficiency <= 0) return null
  const grossGain = capitalEfficiency - 1
  const netGain = grossGain + impermanentLoss
  const feeBoost = capitalEfficiency * feeRate
  const totalNet = netGain + feeBoost
  return { grossGain, impermanentLoss, feeBoost, totalNet, efficient: totalNet > 0, ce: capitalEfficiency, status: 'research-only' }
}

export function meanReversionHalfLife({ costDistanceSeries, tradingDaysPerYear = 365 }) {
  if (!Array.isArray(costDistanceSeries) || costDistanceSeries.length < 5) return null
  const valid = costDistanceSeries.filter(Number.isFinite)
  if (valid.length < 5) return null

  let sumXY = 0
  let sumX2 = 0
  for (let i = 1; i < valid.length; i += 1) {
    sumXY += valid[i] * valid[i - 1]
    sumX2 += valid[i - 1] * valid[i - 1]
  }
  const rho = sumX2 > 0 ? Math.max(-0.99, Math.min(0.99, sumXY / sumX2)) : 0
  const theta = -Math.log(Math.abs(rho))
  const halfLife = rho !== 0 && Math.abs(rho) < 1 ? Math.log(2) / theta : Infinity
  const halfLifeDays = Number.isFinite(halfLife) ? halfLife : null

  const tradingDays = tradingDaysPerYear || 365
  const dayFrac = tradingDays / 365
  const speed = halfLifeDays !== null
    ? halfLifeDays < 5 * dayFrac ? '极快' : halfLifeDays < 15 * dayFrac ? '快' : halfLifeDays < 45 * dayFrac ? '中' : halfLifeDays < 90 * dayFrac ? '慢' : '极慢'
    : '无回归'

  return { rho, theta, halfLifeDays, speed, periodNote: `基于 ${tradingDaysPerYear} 日年基，半衰 ${halfLifeDays !== null ? Math.round(halfLifeDays) : '∞'} 天` }
}

export function gammaPnl({ gamma, priceChange, positionSize = 1 }) {
  if (![gamma, priceChange, positionSize].every(Number.isFinite)) return null
  const dollarGamma = gamma * positionSize
  const pnl = 0.5 * dollarGamma * priceChange * priceChange
  return { dollarGamma, priceChange, gammaPnl: pnl, dailyEstimate: pnl, convexityNote: gamma > 0 ? '多头凸性 · 波动有利' : '空头凸性 · 波动不利' }
}

export function volConfidence({ annualVol, sampleSize = 60, confidenceLevel = 0.68 }) {
  if (![annualVol, sampleSize].every(Number.isFinite)) return null
  if (annualVol <= 0 || sampleSize < 5) return null

  const se = annualVol / Math.sqrt(2 * sampleSize)
  const z = confidenceLevel === 0.95 ? 1.96 : confidenceLevel === 0.68 ? 1.0 : 1.65
  const lower = Math.max(0, annualVol - z * se)
  const upper = annualVol + z * se
  const relativeUncertainty = se / annualVol

  const seBaseline = 1 / Math.sqrt(2 * sampleSize)
  const quality = relativeUncertainty < seBaseline * 2 ? '高精度' : relativeUncertainty < seBaseline * 4 ? '中精度' : relativeUncertainty < seBaseline * 8 ? '低精度' : '不可靠'

  return { annualVol, se, lower, upper, relativeUncertainty, quality, sampleSize, note: `基于 ${sampleSize} 样本，波动率区间估计为 [${(lower * 100).toFixed(1)}%, ${(upper * 100).toFixed(1)}%]（区间水平 ${(confidenceLevel * 100).toFixed(0)}%）` }
}

export function netCarry({ costDistance, fundingRate, holdingDays = 1, tradingDaysPerYear = 365 }) {
  if (![costDistance, fundingRate, holdingDays].every(Number.isFinite)) return null
  const fundingCost = Math.abs(fundingRate) * (holdingDays / tradingDaysPerYear)
  const netReturn = Math.abs(costDistance) - fundingCost
  const breakEven = fundingCost
  return { costDistance, fundingCost, netReturn, breakEven, viable: netReturn > 0, requiredReturn: breakEven + 0.01, status: 'research-only' }
}
