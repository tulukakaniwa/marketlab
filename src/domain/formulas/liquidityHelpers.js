const MIN_ANNUALIZED_VOLATILITY = 0.02
const MAX_ANNUALIZED_VOLATILITY = 2

export function resolveBandwidthModel({ volatility, tradingDaysPerYear, declaredMinimum, declaredScale }) {
  if (!Number.isFinite(volatility) || volatility <= 0) return null
  if (!Number.isFinite(tradingDaysPerYear) || tradingDaysPerYear <= 0) return null
  if (!Number.isFinite(declaredMinimum) || declaredMinimum <= 0) return null
  if (!Number.isFinite(declaredScale) || declaredScale <= 0) return null
  const appliedVolatility = Math.max(MIN_ANNUALIZED_VOLATILITY, Math.min(MAX_ANNUALIZED_VOLATILITY, volatility))
  const sessionVolatility = appliedVolatility / Math.sqrt(tradingDaysPerYear)
  return {
    declaredMinimum,
    declaredScale,
    appliedVolatility,
    sessionVolatility,
    logSigma: Math.max(declaredMinimum, declaredScale * sessionVolatility),
  }
}

export function normalizedEntropy(weights) {
  if (!weights.length) return 0
  const entropy = weights.reduce((sum, weight) => (weight > 0 ? sum - weight * Math.log(weight) : sum), 0)
  return weights.length > 1 ? entropy / Math.log(weights.length) : 0
}

export function countModes(points) {
  if (points.length < 3) return points.length ? 1 : 0
  let count = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    if (points[i].density >= points[i - 1].density && points[i].density > points[i + 1].density) count += 1
  }
  return Math.max(1, count)
}

export function dominantComponent(componentMass) {
  return Object.entries(componentMass).reduce((best, [key, value]) => (value > best.value ? { key, value } : best), {
    key: null,
    value: -Infinity,
  }).key
}

export function normalizeOrderLevels(orderLevels) {
  if (!Array.isArray(orderLevels)) return []
  return orderLevels
    .map((order) => ({
      price: Number(order.price),
      notional: Math.max(0, Number(order.notional) || 0),
      side: order.side,
    }))
    .filter((order) => validPrice(order.price) && order.notional > 0)
}

export function normalizeRange(range) {
  const lower = Number(range?.lower)
  const upper = Number(range?.upper)
  if (!validPrice(lower) || !validPrice(upper) || upper <= lower) return null
  return { lower, upper }
}

export function overlapsRange(lower, upper, range) {
  const normalized = normalizeRange(range)
  return normalized ? upper >= normalized.lower && lower <= normalized.upper : false
}

export function sideOf(price, activePrice) {
  if (!validPrice(price) || !validPrice(activePrice)) return 'unknown'
  return price < activePrice ? 'bid' : 'ask'
}

export function validPrice(value) {
  return Number.isFinite(value) && value > 0
}

export function logDensityToPriceDensity(price, logDensity) {
  return validPrice(price) && Number.isFinite(logDensity) ? logDensity / price : 0
}
