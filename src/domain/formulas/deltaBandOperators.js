import { clamp, normalCdf, normalPdf } from './probability.js'
import { defineLegacyAliasContract } from './legacyAliases.js'

const BACHELIER_CARRY_LEGACY_CONTRACT = defineLegacyAliasContract({
  delta: 'optionDelta',
  gamma: 'optionGamma',
  theta: 'optionThetaPerSession',
  thetaDaily: 'optionThetaPerSession',
  thetaAnnual: 'optionThetaAnnual',
  vegaNormal: 'optionNormalVegaPerUnit',
  rho: 'optionRhoPerPct',
})

/**
 * Second derivative V''(P) of the concentrated-liquidity / GetDelta value curve
 * V(P) = (2*sqrt(P*K*r) - P - K) / (r - 1) on P in [K/r, K*r] with r > 1.
 *
 * Inside the active range:
 *   V''(P) = -sqrt(K * r) / (2 * (r - 1) * P^(3/2)) < 0
 * Outside (K/r, K*r), V(P) is linear (slope 1 below, slope 0 above), so V''(P) = 0.
 */
export function getDeltaBandCurvature({ price, cost, ratio }) {
  if (![price, cost, ratio].every(Number.isFinite)) return null
  if (price <= 0 || cost <= 0 || ratio <= 1) return null
  const low = cost / ratio
  const high = cost * ratio
  const eps = Math.max(price, 1) * 1e-12
  if (price < low - eps || price > high + eps) return 0
  return -Math.sqrt(cost * ratio) / (2 * (ratio - 1) * Math.pow(price, 1.5))
}

/**
 * Exact inverse bijection of getDeltaBands:
 * Given an observed or target concentrated range [lowerPrice, upperPrice],
 * entryPrice in [lowerPrice, upperPrice], and horizon formulaHorizonSessions > 0,
 * recovers the unique (impliedVol, impliedDeltaSlope, impliedAnchor) such that
 * getDeltaBands({ entryPrice, formulaHorizonSessions, iv: impliedVol, deltaSlope: impliedDeltaSlope, z, tradingDaysPerYear }).long
 * reproduces [lowerPrice, impliedAnchor, upperPrice] to machine precision.
 */
export function invertDeltaBand({
  lowerPrice,
  upperPrice,
  entryPrice,
  formulaHorizonSessions,
  z = 1,
  tradingDaysPerYear,
  realizedVol = null,
} = {}) {
  if (![lowerPrice, upperPrice, entryPrice, formulaHorizonSessions, z, tradingDaysPerYear].every(Number.isFinite)) {
    return null
  }
  if (lowerPrice <= 0 || upperPrice <= lowerPrice || formulaHorizonSessions <= 0 || z <= 0 || tradingDaysPerYear <= 0) {
    return null
  }
  const eps = Math.max(upperPrice, 1) * 1e-12
  if (entryPrice < lowerPrice - eps || entryPrice > upperPrice + eps) return null

  const observedRatio = Math.sqrt(upperPrice / lowerPrice)
  if (!(observedRatio > z)) return null

  const impliedAnchor = Math.sqrt(lowerPrice * upperPrice)
  const rho = Math.sqrt(observedRatio / z)
  const wave = (rho - 1) / (rho + 1)
  if (!(wave > 0 && wave < 1)) return null

  const timeScale = Math.sqrt(formulaHorizonSessions / (tradingDaysPerYear * 2 * Math.PI))
  const impliedVol = wave / timeScale
  const rawSlope = (Math.sqrt(upperPrice / entryPrice) - 1) / (observedRatio - 1)
  const impliedDeltaSlope = clamp(rawSlope, 0, 1)
  const impliedShortDualSlope = 1 - impliedDeltaSlope
  const curvatureAtEntry = getDeltaBandCurvature({
    price: entryPrice,
    cost: impliedAnchor,
    ratio: observedRatio,
  })
  const dollarConvexityAtEntry = Number.isFinite(curvatureAtEntry) ? entryPrice * entryPrice * curvatureAtEntry : null
  const hasRealized = Number.isFinite(realizedVol) && realizedVol > 0

  return {
    status: 'ok',
    lowerPrice,
    upperPrice,
    entryPrice,
    impliedAnchor,
    observedRatio,
    timeScale,
    wave,
    impliedVol,
    impliedDeltaSlope,
    impliedShortDualSlope,
    curvatureAtEntry,
    dollarConvexityAtEntry,
    realizedVol: hasRealized ? realizedVol : null,
    impliedMinusRealizedVol: hasRealized ? impliedVol - realizedVol : null,
    impliedToRealizedRatio: hasRealized ? impliedVol / realizedVol : null,
    formulaHorizonSessions,
    tradingDaysPerYear,
    z,
    lawClaimClass: 'exact-identity',
    resultClaimClass: 'scenario-proxy',
    executionAuthority: 'none',
  }
}

/**
 * Spot-carry risk-neutral Bachelier option model:
 *   F = S * exp((r - q) * T),   sigma_T = normalVol * sqrt(T),   d = (F - K) / sigma_T
 *   C = exp(-r * T) * ((F - K) * N(d) + sigma_T * n(d))
 *   P = exp(-r * T) * ((K - F) * N(-d) + sigma_T * n(d))
 *
 * Unlike zero-drift martingale Bachelier, this model shares the exact risk-neutral
 * spot forward E^Q[S_T] = S * exp((r - q) * T) with Black-Scholes, yielding exact
 * closed-form analytical Delta, Gamma, Theta (annual & per-session), Rho, and Normal Vega
 * that satisfy Put-Call Parity identically.
 */
export function bachelierCarryOption({
  entryPrice,
  strikePrice,
  timeToExpirySessions,
  normalVol,
  riskFreeRate = 0,
  dividendYield = 0,
  type = 'put',
  tradingDaysPerYear,
} = {}) {
  const time = timeToExpirySessions / tradingDaysPerYear
  if (
    ![entryPrice, strikePrice, timeToExpirySessions, normalVol, riskFreeRate, dividendYield, tradingDaysPerYear].every(
      Number.isFinite,
    )
  ) {
    return null
  }
  if (entryPrice <= 0 || strikePrice <= 0 || timeToExpirySessions <= 0 || normalVol <= 0 || time <= 0) {
    return null
  }
  const std = normalVol * Math.sqrt(time)
  if (!(std > 0)) return null

  const carryRate = riskFreeRate - dividendYield
  const forwardPrice = entryPrice * Math.exp(carryRate * time)
  const discount = Math.exp(-riskFreeRate * time)
  const d = (forwardPrice - strikePrice) / std
  const nd = normalCdf(d)
  const nNegD = normalCdf(-d)
  const pdf = normalPdf(d)
  const isPut = type === 'put'

  const rawCall = discount * ((forwardPrice - strikePrice) * nd + std * pdf)
  const rawPut = discount * ((strikePrice - forwardPrice) * nNegD + std * pdf)
  const rawPrice = isPut ? rawPut : rawCall
  const optionDelta = Math.exp(-dividendYield * time) * (isPut ? nd - 1 : nd)
  const optionGamma = (Math.exp((riskFreeRate - 2 * dividendYield) * time) * pdf) / std
  const optionThetaAnnual =
    riskFreeRate * rawPrice -
    carryRate * entryPrice * optionDelta -
    (discount * normalVol * pdf) / (2 * Math.sqrt(time))
  const optionThetaPerSession = optionThetaAnnual / tradingDaysPerYear
  const optionRhoPerPct = (time * (entryPrice * optionDelta - rawPrice)) / 100
  const optionNormalVegaPerUnit = discount * Math.sqrt(time) * pdf
  const spotScaledVegaPerPct = 0.01 * entryPrice * optionNormalVegaPerUnit

  return {
    d,
    forwardPrice,
    price: Math.max(0, rawPrice),
    optionDelta,
    optionGamma,
    optionThetaPerSession,
    optionThetaAnnual,
    // Keep optionVegaPerPct null because normalVol has quote/sqrt(year) units rather than lognormal %.
    optionVegaPerPct: null,
    optionNormalVegaPerUnit,
    spotScaledVegaPerPct,
    optionRhoPerPct,
    dividendYield,
    normalVol,
    driftConvention: 'risk-neutral-spot-carry',
    delta: optionDelta,
    gamma: optionGamma,
    theta: optionThetaPerSession,
    thetaDaily: optionThetaPerSession,
    thetaAnnual: optionThetaAnnual,
    vegaNormal: optionNormalVegaPerUnit,
    rho: optionRhoPerPct,
    ...BACHELIER_CARRY_LEGACY_CONTRACT,
    note: 'research-only: spot-carry risk-neutral Bachelier with analytical Theta and Rho',
  }
}
