export { normalCdf, normalPdf, inverseNormalCdf, integrateTrapezoid } from './probability.js'
export {
  GET_DELTA_SOURCE,
  asianOption,
  bachelierOption,
  blackScholes,
  getDeltaBandSlope,
  getDeltaBandValue,
  getDeltaBands,
  riskSurface,
} from './options.js'
export { buildOptionPortfolio, optionLegsFromTemplate, normalizeOptionLegs } from './optionPortfolio.js'
export {
  hedgedLpPortfolioCurve,
  impermanentLoss,
  portfolioValue,
  uniswapV2Inventory,
  uniswapV3HedgedInventory,
  uniswapV3HedgedPosition,
  uniswapV3Inventory,
  uniswapV3Payoff,
} from './lp.js'
export {
  buildDensityComponents,
  componentDensity,
  componentMasses,
  coveredCallFit,
  fingerprintStats,
  laplaceDensity,
  liquidityFingerprint,
  logLaplaceDensity,
  normalDensity,
  normalizeComponents,
} from './liquidity.js'
export { ammCurve, ammLambertCurve, lambertW, numoenSnapshot } from './amm.js'
export { formulaEvidenceCatalog, getFormulaEvidence } from './evidence.js'
export { resolveDeltaSlope, resolveExitTargetReturn } from './inputSemantics.js'
export {
  CK_CAPITAL_EFFICIENCY_INFLECTION,
  capitalEfficiency,
  capitalEfficiencyAtPrice,
  capitalEfficiencyFrontier,
  capitalEfficiencySecondDerivative,
  capitalEfficiencySlope,
  ckCapitalEfficiencyReference,
  resolveArithmeticRangeSpec,
  sampleCapitalEfficiencyCurve,
} from './capitalEfficiency.js'
export { compareFeeCarryToTheta, estimateLpPathFees, lpResearchAttribution, netLpEfficiency } from './lpResearch.js'
export {
  DEFAULT_DYNAMIC_HOLDING_PROFILES,
  deriveDrawdownFeatures,
  deriveDynamicHoldingState,
  deriveShortHoldWindow,
  deriveStructuralHoldWindow,
} from './shortHold.js'

import { inverseNormalCdf, normalCdf } from './probability.js'

export function vixFix({ highestClose, low }) {
  if (![highestClose, low].every(Number.isFinite) || highestClose <= 0) return null
  return Math.max(0, (highestClose - low) / highestClose)
}

export function fundingRate({ perpTwap, spotTwap, hours }) {
  if (![perpTwap, spotTwap, hours].every(Number.isFinite) || spotTwap <= 0 || hours < 0) return null
  const ratio = perpTwap / spotTwap - 1
  const cumulativeFundingEstimate = ratio * (hours / 24)
  return {
    basisEstimate: ratio,
    ratio,
    fundingProxy: cumulativeFundingEstimate,
    cumulativeFundingEstimate,
    funding: cumulativeFundingEstimate,
    hours,
    status: 'proxy-only',
  }
}

export function deviationScore({ costDistance, annualVol, holdingDays = 1, tradingDaysPerYear = 365 }) {
  if (![costDistance, annualVol, holdingDays].every(Number.isFinite)) return null
  if (annualVol <= 0 || holdingDays <= 0) return null
  const periodVol = annualVol * Math.sqrt(holdingDays / tradingDaysPerYear)
  const z = periodVol > 0 ? costDistance / periodVol : 0
  const phi = normalCdf(Math.abs(z))
  const absoluteZPercentile = phi !== null ? Math.max(0.5, Math.min(1, phi)) : 0.5
  const deviationPercentile = Math.max(0, Math.min(1, 2 * absoluteZPercentile - 1))
  const twoSidedTailProbability = Math.max(0, Math.min(1, 2 * (1 - absoluteZPercentile)))
  return {
    z,
    periodVol,
    absoluteZPercentile,
    deviationPercentile,
    twoSidedTailProbability,
    probabilitySemantics: 'normal-reference-extremeness-not-mean-reversion-probability',
    regime: costDistance < 0 ? '折价' : costDistance > 0 ? '溢价' : '平价',
    strength: Math.abs(z) < 0.5 ? '弱' : Math.abs(z) < 1.5 ? '中' : '强',
  }
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
  const rho = sumX2 > 0 ? sumXY / sumX2 : 0
  const absRho = Math.abs(rho)
  const isMeanReverting = absRho < 1
  const theta = absRho > 0 && isMeanReverting ? -Math.log(absRho) : null
  const halfLifeDays = absRho === 0 ? 0 : Number.isFinite(theta) && theta > 0 ? Math.log(2) / theta : null

  const tradingDays = Number.isFinite(tradingDaysPerYear) && tradingDaysPerYear > 0 ? tradingDaysPerYear : 365
  const speed =
    halfLifeDays !== null
      ? halfLifeDays < 5
        ? '极快'
        : halfLifeDays < 15
          ? '快'
          : halfLifeDays < 45
            ? '中'
            : halfLifeDays < 90
              ? '慢'
              : '极慢'
      : '无回归'

  const decayMode = !isMeanReverting
    ? 'non-stationary'
    : absRho === 0
      ? 'immediate'
      : rho < 0
        ? 'oscillating-decay'
        : 'monotonic-decay'
  return {
    rho,
    theta,
    halfLifeDays,
    speed,
    isMeanReverting,
    decayMode,
    sampleSize: valid.length,
    periodNote: `基于 ${valid.length} 个交易日样本（${tradingDays} 日年基），半衰 ${halfLifeDays !== null ? Math.round(halfLifeDays) : '不可定义'} 个交易日`,
  }
}

export function gammaPnl({ gamma, priceChange, positionSize = 1, markPrice = null }) {
  if (![gamma, priceChange, positionSize].every(Number.isFinite)) return null
  if (markPrice !== null && (!Number.isFinite(markPrice) || markPrice <= 0)) return null
  const positionGamma = gamma * positionSize
  const hasMarkPrice = Number.isFinite(markPrice) && markPrice > 0
  const dollarGamma = hasMarkPrice ? positionGamma * markPrice * markPrice : null
  const priceChangePct = hasMarkPrice ? priceChange / markPrice : null
  const pnl = 0.5 * positionGamma * priceChange * priceChange
  const convexityNote = positionGamma > 0 ? '多头凸性 · 波动有利' : positionGamma < 0 ? '空头凸性 · 波动不利' : '零凸性'
  return {
    positionGamma,
    dollarGamma,
    priceChange,
    priceChangePct,
    gammaPnl: pnl,
    dailyEstimate: pnl,
    convexityNote,
    dollarGammaNote: hasMarkPrice
      ? 'Dollar Gamma = positionGamma × markPrice²；Gamma PnL = 0.5 × Dollar Gamma × (ΔP / markPrice)²'
      : '未提供 markPrice；仅计算绝对价格变动口径的 Gamma PnL，Dollar Gamma 不可用',
  }
}

export function volConfidence({ annualVol, sampleSize = 60, confidenceLevel = 0.68 }) {
  if (![annualVol, sampleSize, confidenceLevel].every(Number.isFinite)) return null
  if (annualVol <= 0 || sampleSize < 5 || confidenceLevel <= 0 || confidenceLevel >= 1) return null

  const se = annualVol / Math.sqrt(2 * sampleSize)
  const z = inverseNormalCdf((1 + confidenceLevel) / 2)
  if (!Number.isFinite(z)) return null
  const lower = Math.max(0, annualVol - z * se)
  const upper = annualVol + z * se
  const relativeUncertainty = se / annualVol

  const quality =
    relativeUncertainty <= 0.1
      ? '高精度'
      : relativeUncertainty <= 0.2
        ? '中精度'
        : relativeUncertainty <= 0.3
          ? '低精度'
          : '不可靠'

  return {
    annualVol,
    se,
    lower,
    upper,
    relativeUncertainty,
    quality,
    sampleSize,
    confidenceLevel,
    zScore: z,
    note: `基于 ${sampleSize} 样本，波动率区间估计为 [${(lower * 100).toFixed(1)}%, ${(upper * 100).toFixed(1)}%]（区间水平 ${(confidenceLevel * 100).toFixed(0)}%）`,
  }
}

export function netCarry({
  costDistance,
  fundingRate,
  fundingCost: explicitFundingCost = null,
  holdingDays = 1,
  tradingDaysPerYear = 365,
}) {
  if (![costDistance, holdingDays, tradingDaysPerYear].every(Number.isFinite)) return null
  const fundingCost = Number.isFinite(explicitFundingCost)
    ? Math.abs(explicitFundingCost)
    : Number.isFinite(fundingRate)
      ? Math.abs(fundingRate)
      : null
  if (fundingCost === null) return null
  const netReturn = Math.abs(costDistance) - fundingCost
  const breakEven = fundingCost
  return {
    costDistance,
    fundingCost,
    netReturn,
    breakEven,
    viable: netReturn > 0,
    requiredReturn: breakEven + 0.01,
    status: 'proxy-only',
  }
}
