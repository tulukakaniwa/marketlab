/**
 * MainChart hover legend 域：series 展示元数据 + fallback 取值 + 分组排序
 *
 * 这层是纯视图配置（title/color/unit/group），不沾染 chart 实例或 Vue 响应式。
 * MainChart.vue 在 buildLegend 时把它当作只读字典查询。
 */

import { MARKET_LAB_SERIES_STYLES } from '../domain/research-visualization/marketLabSeriesStyles.js'

const GROUPS = {
  cost: 'price',
  costUpper: 'price',
  costLower: 'price',
  deltaUpper: 'price',
  deltaLower: 'price',
  lpLower: 'price',
  lpUpper: 'price',
  lpRealPrice: 'price',
  entry: 'price',
  target: 'price',
  stop: 'price',
  bsDelta: 'greeks',
  bsGamma: 'greeks',
  bsTheta: 'greeks',
  lpDelta: 'lp',
  lpValue: 'lp',
  lpRealDiv: 'lp',
  lpPoolTurnover: 'lp',
  lpPoolConcentration: 'lp',
  lpCe: 'lp',
  fundingProxy: 'carry',
  netCarry: 'carry',
  equity: 'equity',
  kdjK: 'kdj',
  kdjJ: 'kdj',
  rsi: 'rsi',
}

// Light 图例与两个图表引擎共用 domain 中的名称、颜色和单位。
export const SERIES_META = Object.freeze(
  Object.fromEntries(
    Object.entries(MARKET_LAB_SERIES_STYLES).map(([key, item]) => [
      key,
      Object.freeze({ title: item.label, color: item.color, unit: item.unit, group: GROUPS[key] }),
    ]),
  ),
)

/**
 * 与 MainChart 画线一致：primary 只要整条路径出现过有限值，就整条采用 primary；
 * 只有 primary 全空时才整条回退，避免在同一条线里逐点拼接两个口径。
 */
export function resolvePreferredPathValues(primaryPath, primaryField, fallbackPath, fallbackField) {
  const primary = Array.isArray(primaryPath) ? primaryPath : []
  if (pathHasFiniteValue(primary, primaryField)) return primary.map((row) => row?.[primaryField])
  const fallback = Array.isArray(fallbackPath) ? fallbackPath : []
  return fallback.map((row) => row?.[fallbackField])
}

/** latest-only 快照必须落在 path 自己的观察日，而不是完整 rows 的最后一日。 */
export function latestFinitePathPoint(rows, path, field) {
  if (!Array.isArray(path) || !path.length) return null
  const index = path.length - 1
  const value = path[index]?.[field]
  const time = rows?.[index]?.date ?? path[index]?.date
  return Number.isFinite(value) && time !== null && time !== undefined && time !== '' ? { time, value } : null
}

/**
 * hover 时按 idx 从 formulaPath/costPath/entryPrice 反查某 series 的兜底值
 * （首选是 lightweight-charts 的 param.seriesData，失败时走这条路径）
 *
 * ctx 形如 `{ formulaPath, costPath, entryPrice }`，可以直接传入 Vue 的 props（响应式 proxy 会自动 unwrap），
 * 或任意纯对象。函数只读取这三个字段，不会写入。
 */
export function fallbackValue(key, idx, ctx = {}) {
  const fp = ctx.formulaPath?.[idx]
  switch (key) {
    case 'cost':
      return preferredPathValue(ctx, idx, 'costAnchor', 'anchor')
    case 'costUpper':
      return preferredPathValue(ctx, idx, 'costUpper', 'upper')
    case 'costLower':
      return preferredPathValue(ctx, idx, 'costLower', 'lower')
    case 'deltaUpper':
      return fp?.deltaUpper
    case 'deltaLower':
      return fp?.deltaLower
    case 'lpLower':
      return fp?.lpLowerPrice
    case 'lpUpper':
      return fp?.lpUpperPrice
    case 'lpRealPrice':
      return fp?.lpRealPrice
    case 'entry':
      return ctx.entryPrice
    case 'target':
      return ctx.position?.targetPrice
    case 'stop':
      return ctx.position?.stopPrice
    case 'bsDelta':
      return fp?.optionDelta
    case 'bsGamma':
      return fp?.optionGamma
    case 'bsTheta':
      return fp?.optionThetaDaily
    case 'lpDelta':
      return fp?.lpNormalizedDelta
    case 'lpValue':
      return fp?.lpValue
    case 'lpRealDiv':
      return fp?.lpRealDivergence
    case 'lpPoolTurnover':
      return idx === ctx.formulaPath?.length - 1 ? fp?.lpPoolTurnover24h : null
    case 'lpPoolConcentration':
      return idx === ctx.formulaPath?.length - 1 ? fp?.lpPoolTopReserveShare : null
    case 'lpCe':
      return fp?.capitalEfficiency
    case 'fundingProxy':
      return fp?.fundingProxy
    case 'netCarry':
      return fp?.netCarry
    default:
      return null
  }
}

function preferredPathValue(ctx, idx, primaryField, fallbackField) {
  const primary = Array.isArray(ctx.formulaPath) ? ctx.formulaPath : []
  if (pathHasFiniteValue(primary, primaryField)) return primary[idx]?.[primaryField]
  return Array.isArray(ctx.costPath) ? ctx.costPath[idx]?.[fallbackField] : undefined
}

function pathHasFiniteValue(path, field) {
  return path.some((row) => Number.isFinite(row?.[field]))
}

/** 把扁平 indicators 数组按 group 聚合，并保持稳定的展示顺序 */
export function groupIndicators(indicators) {
  const order = ['price', 'greeks', 'lp', 'carry', 'kdj', 'rsi', 'equity']
  const buckets = new Map(order.map((g) => [g, []]))
  for (const ind of indicators) {
    if (!buckets.has(ind.group)) buckets.set(ind.group, [])
    buckets.get(ind.group).push(ind)
  }
  const out = []
  for (const g of order) {
    const list = buckets.get(g)
    if (list?.length) out.push({ group: g, items: list })
  }
  return out
}
