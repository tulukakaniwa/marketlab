import { buildStatisticalCenterPath } from './statisticalCenter.js'
import { buildEconomicCostPath, queryEconomicCenters } from './economicCenters.js'

export const MARKET_CENTERS_VERSION = 'independent-market-centers.v1'

export function defaultMarketCenterConfig() {
  return {
    statisticalCenter: { lookback: 120, minObservations: 60 },
    vwapCost: { lookback: 120, amountPerVolumeToPrice: null },
    cohortCost: { freeFloat: null, importError: null },
    supplyDemand: { enabled: false, a: null, b: null, c: null, d: null, provenance: null },
    fundamental: { enabled: false, nextDividend: null, requiredReturn: null, growthRate: null, provenance: null },
  }
}

/** Independent research queries. No result enters an OrderPlan or replaces its costAnchor. */
export function buildMarketCentersSnapshot({ rows, observationIndex = null, config = {}, units = {} } = {}) {
  if (!Array.isArray(rows) || !rows.length) return empty('missing-history')
  const index = observationIndex === null ? rows.length - 1 : observationIndex
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) return empty('invalid-observation-index')
  const visible = rows.slice(0, index + 1)
  const date = visible.at(-1)?.date ?? null
  const effective = mergeConfig(config)
  const measurementUnits = { price: 'price', volume: 'reported-volume', ...units }
  measurementUnits.amountPerVolumeToPrice = effective.vwapCost.amountPerVolumeToPrice ?? units.amountPerVolumeToPrice
  const statistics = buildStatisticalCenterPath(visible, effective.statisticalCenter)
  const costs = buildEconomicCostPath(visible, {
    lookback: effective.vwapCost.lookback,
    units: measurementUnits,
    freeFloat: effective.cohortCost.freeFloat,
  })
  // Scenario curves are available only at their explicit observation. Never backfill old sessions.
  const scenarioAt = (item) => item.enabled && item.provenance?.asOfDate === date
  const economic = queryEconomicCenters({
    rows: visible,
    observationDate: date,
    lookback: effective.vwapCost.lookback,
    units: measurementUnits,
    freeFloat: effective.cohortCost.freeFloat,
    supplyDemand: scenarioAt(effective.supplyDemand)
      ? { ...effective.supplyDemand, quantityUnit: 'quantity/session', priceUnit: measurementUnits.price }
      : null,
    gordon: scenarioAt(effective.fundamental)
      ? {
          ...effective.fundamental,
          dividendBasis: 'expected-next-period',
          period: 'year',
          priceUnit: measurementUnits.price,
        }
      : null,
  })
  const formulas = { statisticalCenter: statistics.at(-1), ...economic.formulas }
  const chartPath = visible.map((row, i) => {
    const stat = statistics[i]
    const cost = costs[i]
    const current = i === visible.length - 1
    return {
      date: row?.date ?? null,
      statisticalCenterPrice: stat?.status === 'ready' ? finite(stat.value) : null,
      vwapCostPrice: finite(cost?.vwapCostPrice),
      cohortCostPrice: finite(cost?.cohortCostPrice),
      supplyDemandPrice: current ? plotPrice(formulas.supplyDemand?.value) : null,
      fundamentalPrice: current ? plotPrice(formulas.fundamental?.value) : null,
      centerStates: {
        statisticalCenter: metadata(stat),
        vwapCost: metadata(cost?.vwapCost),
        cohortCost: metadata(cost?.cohortCost),
        supplyDemand: current ? metadata(formulas.supplyDemand) : null,
        fundamental: current ? metadata(formulas.fundamental) : null,
      },
    }
  })
  return {
    modelVersion: MARKET_CENTERS_VERSION,
    status: 'ready',
    asOfDate: date,
    availableAt: date ? `${date}:close` : null,
    visibleRows: visible.length,
    observationIndex: index,
    formulas,
    chartPath,
    futureRowsUsed: false,
    executionAuthority: 'none',
    claimClass: 'independent-research-formulas',
  }
}

function mergeConfig(config) {
  return Object.fromEntries(
    Object.entries(defaultMarketCenterConfig()).map(([key, defaults]) => [key, { ...defaults, ...config[key] }]),
  )
}
function finite(value) {
  return Number.isFinite(value) ? value : null
}
function plotPrice(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}
function metadata(formula) {
  if (!formula) return null
  return {
    status: formula.status,
    state: formula.state,
    reason: formula.reason,
    source: formula.source,
    claimClass: formula.claimClass,
    missingInputs: formula.missingInputs ?? [],
  }
}
function empty(reason) {
  return {
    modelVersion: MARKET_CENTERS_VERSION,
    status: reason === 'missing-history' ? 'warming-up' : 'invalid-data',
    reason,
    asOfDate: null,
    formulas: {},
    chartPath: [],
    futureRowsUsed: false,
    executionAuthority: 'none',
  }
}
