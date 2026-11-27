import { computeKDJ } from '../indicators/kdj.js'
import { computeRSI } from '../indicators/rsi.js'
import { resolveChartOverlayPlan } from './chartPaneLayout.js'
import { buildMarketLabChartControls } from './marketLabChartControls.js'
import { buildMarketLabChartGuides } from './marketLabChartGuides.js'
import { materializeCenterSeries } from './marketLabCenterSeries.js'
import {
  DEFINITIONS,
  MARKET_LAB_CHART_INDICATOR_CATALOG,
  MARKET_LAB_CHART_INDICATOR_GROUPS,
  publicMeta,
} from './marketLabChartDefinitions.js'

export { MARKET_LAB_CHART_INDICATOR_CATALOG, MARKET_LAB_CHART_INDICATOR_GROUPS }

/**
 * 构建可供 Vela、HQ 期权图或其它视图适配器消费的稳定查询结果。
 * points 只包含带日期的有限数值；关闭的 overlay 仍保留组和 availability，
 * 但不会出现在组的 active series 中。
 */
export function queryMarketLabChartSeries({
  rows = [],
  formulaPath = [],
  costPath = [],
  causalPath = [],
  centerPath = [],
  overlays = {},
  entryPrice = null,
  position = null,
  replay = null,
} = {}) {
  const context = buildContext({ rows, formulaPath, costPath, causalPath, centerPath, entryPrice, position, replay })
  const plan = resolveChartOverlayPlan({ overlays, formulaPath: context.formulaPath })
  const candidates = [
    ...materializeCenterSeries(context, plan),
    ...DEFINITIONS.map((definition) => materialize(definition, context, plan)),
  ]
  const groups = MARKET_LAB_CHART_INDICATOR_GROUPS.map((meta) => buildGroup(meta, candidates, context.rows)).map(
    (item) => ({
      ...item,
      series: item.series.filter((series) => series.active).map(({ active: _active, ...series }) => series),
    }),
  )
  const controls = buildMarketLabChartControls({ candidates, context, overlays, plan })
  const availableSeriesCount = candidates.filter((candidate) => candidate.points.length).length
  const activeSeriesCount = candidates.filter((candidate) => candidate.active && candidate.points.length).length

  return {
    dates: context.rows.map((row) => row?.date).filter(validTime),
    centerDescriptors: candidates.filter((candidate) => candidate.centerFormula),
    groups,
    controls,
    availability: controls,
    activeSeriesCount,
    availableSeriesCount,
  }
}

function buildContext({ rows, formulaPath, costPath, causalPath, centerPath, entryPrice, position, replay }) {
  const safeRows = Array.isArray(rows) ? rows : []
  return {
    rows: safeRows,
    formulaPath: Array.isArray(formulaPath) ? formulaPath : [],
    costPath: Array.isArray(costPath) ? costPath : [],
    causalPath: Array.isArray(causalPath) ? causalPath : [],
    centerPath: Array.isArray(centerPath) ? centerPath : [],
    entryPrice,
    position: position && typeof position === 'object' ? position : {},
    replay: replay && typeof replay === 'object' ? replay : {},
    kdj: safeCompute(() => computeKDJ(safeRows)),
    rsi: safeCompute(() => computeRSI(safeRows)),
  }
}

function materialize(definition, context, plan) {
  const selected = selectSource(definition, context)
  const points = buildPoints(definition, selected, context)
  return {
    ...publicMeta(definition, selected),
    state: definition.state,
    reason: definition.state === 'estimated' ? 'research-estimate' : 'finite-output-available',
    active: readGate(plan, definition.gate),
    controls: definition.controls,
    missingSource: missingSource(definition),
    points,
  }
}

function buildGroup(meta, candidates, rows) {
  const allSeries = candidates.filter((candidate) => candidate.group === meta.id)
  const available = allSeries.filter((candidate) => candidate.points.length)
  const active = allSeries.filter(
    (candidate) => candidate.active && (candidate.points.length || candidate.centerFormula),
  )
  const state = aggregateState(available)
  const groupActive = allSeries.some((candidate) => candidate.active)
  return {
    ...meta,
    active: groupActive,
    state,
    reason: groupReason({ state, groupActive }),
    activeSeriesCount: active.filter((candidate) => candidate.points.length).length,
    availableSeriesCount: available.length,
    guides: active.length ? buildMarketLabChartGuides(meta.id, rows) : [],
    series: active,
  }
}

function buildPoints(definition, selected, context) {
  if (definition.kind === 'constant') return constantPoints(context.rows, selected.value)
  if (definition.kind === 'equity') return equityPoints(context.rows, context.replay?.equityCurve)
  if (definition.kind === 'kdj-mean')
    return derivedPoints(context.kdj, (row) =>
      Number.isFinite(row?.k) && Number.isFinite(row?.d) ? (row.k + row.d) / 2 : null,
    )
  if (definition.kind === 'kdj-j') return derivedPoints(context.kdj, (row) => row?.j)
  if (definition.kind === 'rsi') return derivedPoints(context.rsi, (row) => row?.custom)

  const path = context[selected.source]
  if (definition.pointMode === 'latest') {
    const index = path.length - 1
    return pathPoint(index, selected.field, path)
  }
  return path.flatMap((_, index) => pathPoint(index, selected.field, path))
}

function selectSource(definition, context) {
  if (definition.kind === 'constant') {
    const source = definition.sources[0]
    const value =
      source.source === 'position'
        ? context.position[source.field]
        : source.source === 'rows'
          ? context.rows.at(-1)?.[source.field]
          : context.entryPrice
    return { ...definition.sources[0], value }
  }
  if (definition.kind !== 'path') return definition.sources[0]
  for (const source of definition.sources) {
    const path = context[source.source]
    if (path.some((row) => Number.isFinite(row?.[source.field]))) return source
  }
  return definition.sources[0]
}

function pathPoint(index, field, path) {
  const value = path[index]?.[field]
  const time = path[index]?.date
  return Number.isFinite(value) && validTime(time) ? [{ time, value }] : []
}

function constantPoints(rows, value) {
  if (!Number.isFinite(value)) return []
  return rows.filter((row) => validTime(row?.date)).map((row) => ({ time: row.date, value }))
}

function equityPoints(rows, curve) {
  if (!Array.isArray(curve)) return []
  const values = new Map(curve.filter((point) => validTime(point?.date)).map((point) => [point.date, point.equity]))
  return rows.flatMap((row) => {
    const value = values.get(row?.date)
    return validTime(row?.date) && Number.isFinite(value) ? [{ time: row.date, value }] : []
  })
}

function derivedPoints(path, valueAt) {
  return path.flatMap((row) => {
    const value = valueAt(row)
    return validTime(row?.date) && Number.isFinite(value) ? [{ time: row.date, value }] : []
  })
}

function missingSource(definition) {
  return definition.sources.map((source) => `${source.source}.${source.field}`).join('|')
}

function aggregateState(candidates) {
  const states = candidates.map((candidate) => candidate.state)
  if (!states.length) return 'missing-input'
  return states.includes('estimated') ? 'estimated' : 'ready'
}

function groupReason({ state, groupActive }) {
  if (state === 'missing-input') return 'no-finite-output'
  if (!groupActive) return 'overlay-disabled'
  return state === 'estimated' ? 'research-estimate' : 'finite-output-available'
}

function readGate(plan, gate) {
  return gate.split('.').reduce((value, key) => value?.[key], plan) === true
}

function safeCompute(compute) {
  try {
    return compute()
  } catch {
    return []
  }
}

function validTime(value) {
  return value !== null && value !== undefined && value !== ''
}
