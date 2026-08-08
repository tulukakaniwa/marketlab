import { existsSync, readFileSync } from 'node:fs'
import { uniswapV3Inventory } from '../../../../src/domain/formulas/core.js'

export const CLAIM_CLASS_CONTRACT = Object.freeze({
  allowedValues: Object.freeze([
    'exact-identity',
    'sample-estimate',
    'calibrated-estimate',
    'scenario-proxy',
    'missing-input',
  ]),
})

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

export const SYNTHETIC_CK_GEOMETRY_DISCLOSURE = Object.freeze({
  model: 'synthetic-ck-uniswap-v3-geometry',
  inputMode: 'synthetic',
  liquidity: 1,
  rangeRule: 'ATR-derived symmetric range around the rolling cost anchor',
  normalizationRule: 'unit-liquidity value divided by the same synthetic range valued at its rolling cost anchor',
  interpretation: 'dimensionless geometry diagnostic relative to the rolling-anchor reference',
  limitation: 'not a real LP position, token holding, fee income, or investment return',
})

export function buildSyntheticCkGeometryState(market, row) {
  if (!market || !row || !Number.isFinite(market.costAnchor) || market.costAnchor <= 0) return null
  if (!Number.isFinite(row.close) || row.close <= 0) return null

  const rangeWidth = Math.min(Math.max(market.atrPercent ?? 0.05, 0.03), 0.5)
  const lowerPrice = market.costAnchor * Math.max(1 - rangeWidth, 0.001)
  const upperPrice = market.costAnchor * (1 + rangeWidth)
  const geometry = uniswapV3Inventory({
    markPrice: row.close,
    lowerPrice,
    upperPrice,
    liquidity: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.liquidity,
  })
  const anchorReference = uniswapV3Inventory({
    markPrice: market.costAnchor,
    lowerPrice,
    upperPrice,
    liquidity: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.liquidity,
  })
  if (!Number.isFinite(geometry?.value) || !Number.isFinite(anchorReference?.value) || anchorReference.value <= 0) return null

  return {
    model: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.model,
    inputMode: SYNTHETIC_CK_GEOMETRY_DISCLOSURE.inputMode,
    normalizedValue: geometry.value / anchorReference.value,
    unitLiquidityValue: geometry.value,
    anchorReferenceValue: anchorReference.value,
    region: geometry.zone,
    lowerPrice,
    upperPrice,
    rangeWidth,
    rangeWidthPct: rangeWidth * 100,
  }
}

export function passesAshareShebaoFilter(entry, whitelist, required = true) {
  if (!required || entry?.market !== 'A股') return true
  return whitelist instanceof Set && whitelist.has(String(entry?.symbol ?? ''))
}

export function isPositiveMonotonicMeanReversion(meanReversion) {
  return meanReversion?.isMeanReverting === true &&
    meanReversion?.decayMode === 'monotonic-decay' &&
    Number.isFinite(meanReversion?.rho) &&
    meanReversion.rho > 0 &&
    meanReversion.rho < 1 &&
    Number.isFinite(meanReversion?.halfLifeDays) &&
    meanReversion.halfLifeDays > 0
}

export function empiricalDeviationStats(values, current) {
  const valid = Array.isArray(values) ? values.filter(Number.isFinite) : []
  if (!valid.length || !Number.isFinite(current)) return null

  const lowerCount = valid.filter((value) => value <= current).length
  const upperCount = valid.filter((value) => value >= current).length
  const lowerTail = lowerCount / valid.length
  const upperTail = upperCount / valid.length
  return {
    current,
    sampleSize: valid.length,
    percentilePct: lowerTail * 100,
    lowerTailPct: lowerTail * 100,
    upperTailPct: upperTail * 100,
    twoSidedTailPct: Math.min(1, 2 * Math.min(lowerTail, upperTail)) * 100,
    interpretation: 'empirical historical rank and tail share; not a probability of mean reversion',
  }
}
