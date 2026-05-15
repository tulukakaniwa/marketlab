import { integrateTrapezoid, normalCdf, inverseNormalCdf } from './probability.js'

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

export function coveredCallFit(price, { strikePrice, iv = 1, lower = 0, upper = Infinity } = {}) {
  if (![price, strikePrice, iv].every(Number.isFinite) || price <= 0 || strikePrice <= 0 || iv <= 0) return null
  if (price < lower || price > upper) return 0
  const floor = Math.max(1e-9, normalCdf(-iv / 2) ?? 1e-9)
  const quantileInput = (normalCdf(-iv / 2) ?? 0.3) * (price / strikePrice)
  const q = inverseNormalCdf(Math.min(0.999999, Math.max(0.000001, quantileInput))) ?? 0
  return Math.max(0, normalCdf(-q - iv) / floor)
}

export function liquidityFingerprint({
  entryPrice,
  priceGrid,
  distribution = 'log-laplace',
  mu,
  lambda,
  kappa,
  lowerFactor = 0.2,
  upperFactor = 5,
  segmentCount = 8,
  integrationSteps = 256,
}) {
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) return null
  const lower = entryPrice * lowerFactor
  const upper = entryPrice * upperFactor
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return null
  const n = priceGrid && priceGrid > 2 ? Math.round(priceGrid) : 60
  const prices = Array.from({ length: n }, (_, i) => lower + (upper - lower) * i / (n - 1))
  const logMu = mu ?? Math.log(entryPrice)
  const lam = lambda ?? 2
  const kap = kappa ?? 1

  const density = distribution === 'log-laplace'
    ? (p) => logLaplaceDensity(p, { mu: logMu, lambda: lam, kappa: kap, lower, upper }) ?? 0
    : distribution === 'covered-call-fit'
      ? (p) => coveredCallFit(p, { strikePrice: entryPrice, iv: 1 / Math.max(lam, 0.001), lower, upper }) ?? 0
      : (p) => laplaceDensity(p, { mu: entryPrice, lambda: lam, kappa: kap }) ?? 0

  const values = prices.map((p) => ({ price: p, density: density(p) }))
  const maxDensity = Math.max(...values.map((v) => v.density), 0)
  const totalIntegral = integrateTrapezoid(density, lower, upper, integrationSteps) ?? 0
  const count = Math.max(1, Math.round(segmentCount))
  const rawSegments = Array.from({ length: count }, (_, i) => {
    const lo = lower + (upper - lower) * i / count
    const hi = lower + (upper - lower) * (i + 1) / count
    const mass = integrateTrapezoid(density, lo, hi, Math.max(16, Math.round(integrationSteps / count))) ?? 0
    return { lower: lo, upper: hi, mid: (lo + hi) / 2, mass, weight: totalIntegral > 0 ? mass / totalIntegral : 1 / count }
  })
  const segmentTotal = rawSegments.reduce((sum, item) => sum + item.weight, 0)
  const segments = rawSegments.map((item) => ({
    ...item,
    weight: segmentTotal > 0 ? item.weight / segmentTotal : 1 / count,
  }))

  return {
    entryPrice,
    lower,
    upper,
    prices: values,
    maxDensity,
    totalIntegral,
    segments,
    params: { distribution, mu: logMu, lambda: lam, kappa: kap, segmentCount: count },
    note: 'research-only: continuous density normalized by numerical integration, then discretized into LP interval weights',
  }
}
