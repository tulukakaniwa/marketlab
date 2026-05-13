function adaptiveWindow(n, fallback = 60) {
  if (n >= 500) return fallback
  if (n < 30) return Math.max(5, Math.floor(n / 3))
  return Math.max(10, Math.floor(fallback * n / 500))
}

let COST_WINDOW = 60
let RECENT_WINDOW = 20
let VOL_WINDOW = 60

function setWindows(n) {
  COST_WINDOW = adaptiveWindow(n, 60)
  RECENT_WINDOW = Math.max(3, Math.floor(COST_WINDOW / 3))
  VOL_WINDOW = COST_WINDOW
}

export function buildMarketState(rows, tradingDaysPerYear = 365) {
  if (!Array.isArray(rows) || rows.length < 2) return null
  return buildMarketStatePath(rows, tradingDaysPerYear).at(-1)
}

export function buildMarketStatePath(rows, tradingDaysPerYear = 365) {
  if (!Array.isArray(rows) || rows.length < 2) return []
  setWindows(rows.length)
  const returns = rows.map((row, index) => index > 0 ? Math.log(row.close / rows[index - 1].close) : 0)
  const trueRanges = rows.map((row, index) => {
    if (index === 0) return 0
    const prevClose = rows[index - 1].close
    return Math.max(row.high - row.low, Math.abs(row.high - prevClose), Math.abs(row.low - prevClose))
  })
  const first = rows[0]
  let peak = first.close
  let peakDrawdown = 0

  return rows.map((last, index) => {
    peak = Math.max(peak, last.close)
    peakDrawdown = Math.min(peakDrawdown, peak > 0 ? (last.close - peak) / peak : 0)
    const returnWindow = windowValues(returns, Math.max(1, index - VOL_WINDOW + 1), index + 1)
    const returnBasis = returnWindow.length >= 5 ? returnWindow : windowValues(returns, 1, index + 1)
    const annualVol = standardDeviation(returnBasis) * Math.sqrt(tradingDaysPerYear)
    const atr = average(windowValues(trueRanges, Math.max(1, index - 13), index + 1))
    const cost = rollingCost(rows, index)
    const previousCost = index > 5 ? rollingCost(rows, index - 5) : cost
    return {
      markPrice: last.close,
      firstPrice: first.close,
      annualVol,
      atr,
      atrPercent: last.close > 0 ? atr / last.close : 0,
      costAnchor: cost.anchor,
      costRecent: cost.recent,
      costLow: cost.lower,
      costHigh: cost.upper,
      costDistance: cost.anchor > 0 ? (last.close - cost.anchor) / cost.anchor : 0,
      momentum5: momentumAt(rows, index, 5),
      momentum20: momentumAt(rows, index, 20),
      costSlope5: previousCost.anchor > 0 ? (cost.anchor - previousCost.anchor) / previousCost.anchor : 0,
      maxDrawdown: peakDrawdown,
      rows: index + 1,
      range: `${first.date} ~ ${last.date}`,
    }
  })
}

function momentum(rows, window) {
  if (rows.length <= window) return 0
  const current = rows.at(-1)?.close
  const previous = rows.at(-1 - window)?.close
  return previous > 0 ? (current - previous) / previous : 0
}

function momentumAt(rows, index, window) {
  if (index < window) return 0
  const current = rows[index]?.close
  const previous = rows[index - window]?.close
  return previous > 0 ? (current - previous) / previous : 0
}

export function buildCostPath(rows) {
  return rows.map((row, index) => {
    const cost = rollingCost(rows, index)
    return {
      date: row.date,
      close: row.close,
      anchor: cost?.anchor ?? null,
      lower: cost?.lower ?? null,
      upper: cost?.upper ?? null,
    }
  })
}

function rollingCost(rows, index) {
  const end = index + 1
  const anchorRows = rows.slice(Math.max(0, end - COST_WINDOW), end)
  const recentRows = rows.slice(Math.max(0, end - RECENT_WINDOW), end)
  const bandRows = rows.slice(Math.max(0, end - COST_WINDOW - 1), end)
  const anchor = weightedTypicalCost(anchorRows)
  const recent = weightedTypicalCost(recentRows)
  const returns = bandRows.slice(1).map((row, offset) => Math.log(row.close / bandRows[offset].close))
  const volEstimate = standardDeviation(returns) * Math.sqrt(Math.min(RECENT_WINDOW, returns.length || 1))
  const minBand = Math.max(volEstimate * 0.25, 0.005) // minimum band is 25% of vol estimate or 0.5%
  const bandWidth = Math.max(volEstimate, minBand)
  return {
    anchor,
    recent,
    lower: anchor * (1 - bandWidth),
    upper: anchor * (1 + bandWidth),
  }
}

function weightedTypicalCost(rows) {
  const rawVolume = rows.reduce((sum, row) => sum + row.volume, 0)
  const usesEqualWeight = rawVolume <= 0
  const denominator = usesEqualWeight ? rows.length : rawVolume
  return rows.reduce((sum, row) => {
    const typical = (row.high + row.low + row.close) / 3
    return sum + typical * (usesEqualWeight ? 1 : row.volume)
  }, 0) / denominator
}

function average(values) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function windowValues(values, start, end) {
  return values.slice(Math.max(0, start), Math.max(0, end))
}

function standardDeviation(values) {
  if (values.length < 2) return 0
  const mean = average(values)
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(values.length - 1, 1)
  return Math.sqrt(variance)
}

function maxDrawdown(rows) {
  let peak = rows[0]?.close ?? 0
  let drawdown = 0
  for (const row of rows) {
    peak = Math.max(peak, row.close)
    drawdown = Math.min(drawdown, peak > 0 ? (row.close - peak) / peak : 0)
  }
  return drawdown
}
