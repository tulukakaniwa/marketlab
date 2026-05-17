import { existsSync, readFileSync } from 'node:fs'

export function loadNameMap(path) {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    console.warn(`cannot read stock name map ${path}: ${error.message}`)
    return {}
  }
}

export function resolveInstrumentName(entry, nameMap) {
  const symbol = String(entry.symbol ?? '')
  const mapped = nameMap[symbol] ?? nameMap[symbol.replace('.HK', '_HK')]
  if (mapped?.name) return { name: mapped.name, source: mapped.source ?? 'local-name-map' }
  const label = String(entry.label ?? '')
  const unresolved = !label || label === symbol || label === symbol.replace('.HK', '_HK')
  return { name: unresolved ? symbol : label, source: unresolved ? 'unresolved-local-index' : 'stock-index' }
}

export function buildScenario({ close, atrPct, drawdown120, formula, status }) {
  const halfLife = formula?.meanReversion?.halfLifeDays
  const z = Math.abs(formula?.deviation?.z ?? 0)
  const targets = candidateUpsides(close, formula)
  const baseHigh = bounded(firstPositive([targets.costHigh, targets.longHigh, atrPct * 1.4]), 2, 12)
  const baseLow = bounded(baseHigh * 0.45, 1, Math.max(1.5, baseHigh - 1))
  const stretchHigh = bounded(firstPositive([targets.shortCost, atrPct * 2.7]), baseHigh + 1.5, 25)
  const execution = executionBias({ status, z, orderState: formula?.orderPlan?.state, drawdown120 })
  return {
    holding: holdingWindow(halfLife, formula?.meanReversion?.speed),
    baseReturn: `+${round(baseLow, 1)}%~+${round(baseHigh, 1)}%`,
    stretchReturn: `+${round(Math.max(baseHigh, stretchHigh * 0.65), 1)}%~+${round(stretchHigh, 1)}%`,
    execution,
    riskTrigger: riskTrigger(formula, atrPct),
  }
}

export function scenarioText(scenario) {
  if (!scenario) return 'scenario n/a'
  return `${scenario.holding}; base ${scenario.baseReturn}; stretch ${scenario.stretchReturn}; ${scenario.execution}`
}

function candidateUpsides(close, formula) {
  return {
    costHigh: pctChange(close, formula?.cost?.high),
    longHigh: pctChange(close, formula?.deltaBands?.longHigh),
    shortCost: pctChange(close, formula?.deltaBands?.shortCost),
  }
}

function holdingWindow(halfLife, speed) {
  if (speed === '极快' || speed === '快') return '5-15 trading days'
  if (speed === '中') return '10-25 trading days'
  if (speed === '慢') return '15-35 trading days'
  if (Number.isFinite(halfLife) && halfLife > 60) return '30+ trading days / wait'
  return '10-30 trading days'
}

function executionBias({ status, z, orderState, drawdown120 }) {
  if (status !== '观察') return 'wait for confirmation'
  if (z > 1.5 || String(orderState).includes('高于成本带')) return 'wait pullback or volume confirmation'
  if (drawdown120 < -25) return 'small size until drawdown stabilizes'
  return 'observe for cost-band hold'
}

function riskTrigger(formula, atrPct) {
  const low = formula?.cost?.low
  const lowText = Number.isFinite(low) ? `costLow ${low}` : 'costLow n/a'
  return `${lowText}; adverse move > ${round(Math.max(atrPct, 1), 1)}%`
}

function firstPositive(values) {
  for (const value of values) {
    if (Number.isFinite(value) && value > 0) return value
  }
  return 3
}

function pctChange(start, end) {
  if (!Number.isFinite(start) || start <= 0 || !Number.isFinite(end)) return null
  return ((end - start) / start) * 100
}

function bounded(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function round(value, digits = 1) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
