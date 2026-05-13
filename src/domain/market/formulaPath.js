import { blackScholes, getDeltaBands, uniswapV3Inventory } from '../formulas/core.js'
import { buildCostPath } from './cost.js'

const VOL_WINDOW = 60

export function buildFormulaPath(rows, input) {
  if (!Array.isArray(rows) || rows.length < 2) return []
  const costPath = buildCostPath(rows)
  const tdpy = Number(input.tradingDaysPerYear) || 365
  return rows.map((row, index) => {
    const iv = rollingAnnualVol(rows, index, tdpy) || Number(input.iv) || 0
    const bandAnchor = costPath[index]?.anchor || row.close
    const deltaBands = getDeltaBands({
      entryPrice: bandAnchor,
      holdingDays: positive(input.holdingDays) || 30,
      iv,
      targetReturn: Number(input.targetReturn) || 0,
      tradingDaysPerYear: tdpy,
    })
    const scenarioStrike = input.pathUsesScenarioInputs ? positive(input.strikePrice) : null
    const scenarioStart = input.pathUsesScenarioInputs ? positive(input.startPrice) : null
    const option = blackScholes({
      entryPrice: row.close,
      strikePrice: scenarioStrike || bandAnchor,
      holdingDays: positive(input.holdingDays) || 30,
      iv: iv || 0.01,
      riskFreeRate: Number(input.riskFreeRate) || 0,
      type: input.optionType,
      tradingDaysPerYear: tdpy,
    })
    const lp = uniswapV3Inventory({
      markPrice: row.close,
      lowerPrice: lpLower(input, scenarioStart || bandAnchor),
      upperPrice: lpUpper(input, scenarioStart || bandAnchor),
      liquidity: positive(input.liquidity) ?? 1,
    })

    return {
      date: row.date,
      bandAnchor: finite(bandAnchor),
      iv: finite(iv),
      deltaLower: finite(deltaBands?.long.low),
      deltaCost: finite(deltaBands?.long.cost),
      deltaUpper: finite(deltaBands?.long.high),
      optionDelta: finite(option?.delta),
      lpInventoryDelta: finite(normalizeInventory(lp, row.close)),
    }
  })
}

function rollingAnnualVol(rows, index, tradingDaysPerYear = 365) {
  if (index < 2) return null
  const start = Math.max(1, index - VOL_WINDOW + 1)
  const returns = []
  for (let i = start; i <= index; i += 1) {
    const previous = rows[i - 1]?.close
    const current = rows[i]?.close
    if (previous > 0 && current > 0) returns.push(Math.log(current / previous))
  }
  if (returns.length < 5) return null
  return standardDeviation(returns) * Math.sqrt(tradingDaysPerYear)
}

function lpLower(input, start) {
  const width = Math.min(Math.max(Number(input.rangeWidth) || 0.1, 0.001), 0.95)
  return start * Math.max(1 - width, 0.001)
}

function lpUpper(input, start) {
  const width = Math.min(Math.max(Number(input.rangeWidth) || 0.1, 0.001), 0.95)
  const skew = Math.max(Number(input.skew) || 1, 0.01)
  return start * (1 + width * skew)
}

function normalizeInventory(lp, markPrice) {
  if (!lp || !Number.isFinite(lp.value) || lp.value <= 0 || markPrice <= 0) return null
  return (lp.inventoryDelta * markPrice) / lp.value
}

function standardDeviation(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / Math.max(values.length - 1, 1)
  return Math.sqrt(variance)
}

function positive(value) {
  const next = Number(value)
  return Number.isFinite(next) && next > 0 ? next : null
}

function finite(value) {
  return Number.isFinite(value) ? value : null
}
