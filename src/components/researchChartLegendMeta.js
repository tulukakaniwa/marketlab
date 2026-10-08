/**
 * 研究图 hover legend 域：series 展示元数据 + fallback 取值 + 分组排序
 *
 * 这层是纯视图配置（title/color/unit/group），不沾染 chart 实例或 Vue 响应式。
 * 图例视图把它当作只读字典查询。
 */

import { MARKET_LAB_SERIES_STYLES } from '../domain/research-visualization/marketLabSeriesStyles.js'

const GROUPS = {
  causalEquilibrium: 'price',
  statisticalCenter: 'price',
  vwapCost: 'price',
  cohortCost: 'price',
  supplyDemand: 'price',
  fundamental: 'price',
  cost: 'price',
  costUpper: 'price',
  costLower: 'price',
  deltaUpper: 'price',
  deltaLower: 'price',
  lpLower: 'price',
  lpUpper: 'price',
  lpRealPrice: 'price',
  entry: 'price',
  mark: 'price',
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
  cumulativeFundingProxy: 'carry',
  netCarry: 'carry',
  equity: 'equity',
  kdjK: 'kdj',
  kdjJ: 'kdj',
  rsi: 'rsi',
}

// 研究图例与两个图表引擎共用 domain 中的名称、颜色和单位。
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
  const selected = resolvePreferredPath(primaryPath, primaryField, fallbackPath, fallbackField)
  return selected.path.map((row) => row?.[selected.field])
}

export function resolvePreferredPath(primaryPath, primaryField, fallbackPath, fallbackField) {
  const primary = Array.isArray(primaryPath) ? primaryPath : []
  if (pathHasFiniteValue(primary, primaryField)) return { path: primary, field: primaryField }
  return { path: Array.isArray(fallbackPath) ? fallbackPath : [], field: fallbackField }
}

/** latest-only 快照必须落在 path 自己的观察日，而不是完整 rows 的最后一日。 */
export function latestFinitePathPoint(_rows, path, field) {
  if (!Array.isArray(path) || !path.length) return null
  const index = path.length - 1
  const value = path[index]?.[field]
  const time = path[index]?.date
  return Number.isFinite(value) && time !== null && time !== undefined && time !== '' ? { time, value } : null
}

/**
 * hover 时按 idx 从 formulaPath/costPath/entryPrice 反查某 series 的兜底值
 * （按观察日读取已有路径，不插值、不重算公式）
 *
 * ctx 形如 `{ rows, formulaPath, costPath, entryPrice }`，可以直接传入 Vue 的 props（响应式 proxy 会自动 unwrap），
 * 或任意纯对象。存在带日期的 rows/path 时按日期关联；旧的无日期测试夹具才回退索引读取。
 */
export function fallbackValue(key, idx, ctx = {}) {
  if (['statisticalCenter', 'vwapCost', 'cohortCost', 'supplyDemand', 'fundamental'].includes(key)) {
    const row = pathRowAtObservation(ctx.centerPath, idx, ctx.rows)
    if (key === 'statisticalCenter' && row?.centerStates?.statisticalCenter?.status !== 'ready') return null
    if (['supplyDemand', 'fundamental'].includes(key) && row !== ctx.centerPath?.at(-1)) return null
    return row?.[`${key}Price`]
  }
  const fp = pathRowAtObservation(ctx.formulaPath, idx, ctx.rows)
  switch (key) {
    case 'causalEquilibrium':
      return pathRowAtObservation(ctx.causalPath, idx, ctx.rows)?.equilibriumPrice
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
    case 'mark':
      return ctx.rows?.at(-1)?.close
    case 'target':
      return ctx.position?.targetPrice
    case 'stop':
      return ctx.position?.stopPrice
    case 'bsDelta':
      return fp?.optionDelta
    case 'bsGamma':
      return fp?.optionGamma
    case 'bsTheta':
      return fp?.optionThetaPerSession
    case 'lpDelta':
      return fp?.lpNormalizedDelta
    case 'lpValue':
      return fp?.lpValue
    case 'lpRealDiv':
      return fp?.lpRealDivergence
    case 'lpPoolTurnover':
      return fp && fp === ctx.formulaPath?.at(-1) ? fp.lpPoolTurnover24h : null
    case 'lpPoolConcentration':
      return fp && fp === ctx.formulaPath?.at(-1) ? fp.lpPoolTopReserveShare : null
    case 'lpCe':
      return fp?.capitalEfficiency
    case 'cumulativeFundingProxy':
      return fp?.cumulativeFundingProxy
    case 'netCarry':
      return fp?.netCarry
    default:
      return null
  }
}

function preferredPathValue(ctx, idx, primaryField, fallbackField) {
  const selected = resolvePreferredPath(ctx.formulaPath, primaryField, ctx.costPath, fallbackField)
  return pathRowAtObservation(selected.path, idx, ctx.rows)?.[selected.field]
}

function pathRowAtObservation(path, idx, rows) {
  if (!Array.isArray(path)) return undefined
  const date = rows?.[idx]?.date
  if (date !== null && date !== undefined && date !== '') {
    for (let index = path.length - 1; index >= 0; index -= 1) {
      if (path[index]?.date === date) return path[index]
    }
    return undefined
  }
  return path[idx]
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
