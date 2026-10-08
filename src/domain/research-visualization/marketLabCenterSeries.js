import { getMarketLabSeriesStyle } from './marketLabSeriesStyles.js'

const FIELDS = Object.freeze({
  statisticalCenter: 'statisticalCenterPrice',
  vwapCost: 'vwapCostPrice',
  cohortCost: 'cohortCostPrice',
  supplyDemand: 'supplyDemandPrice',
  fundamental: 'fundamentalPrice',
})
const CURRENT_ONLY = new Set(['supplyDemand', 'fundamental'])

export const CENTER_SERIES_CATALOG = Object.freeze(
  Object.entries(FIELDS).map(([id, field]) =>
    Object.freeze({
      id,
      ...getMarketLabSeriesStyle(id),
      group: 'price',
      pane: 'main',
      source: 'centerPath',
      field,
      sourceField: `centerPath.${field}`,
      render: CURRENT_ONLY.has(id) ? 'point' : 'line',
      centerFormula: id,
    }),
  ),
)

/** Only translate explicit domain values/statuses; never fit or invent a center in the view query. */
export function materializeCenterSeries(context, plan) {
  const path = context.centerPath
  return CENTER_SERIES_CATALOG.map((meta) => {
    const last = path.at(-1)
    const observations = CURRENT_ONLY.has(meta.id) ? (last ? [last] : []) : path
    const points = observations.flatMap((row) => {
      const value = row?.[meta.field]
      const identified = meta.id !== 'statisticalCenter' || row?.centerStates?.statisticalCenter?.status === 'ready'
      return identified && Number.isFinite(value) && row?.date ? [{ time: row.date, value }] : []
    })
    const latestState = last?.centerStates?.[meta.id]
    const ready = latestState?.status === 'ready'
    return {
      ...meta,
      label: meta.id === 'vwapCost' ? vwapLabel(latestState) : meta.label,
      controls: [meta.id],
      active: plan.price[meta.id] === true,
      state: ready && meta.id === 'statisticalCenter' ? 'ready' : 'estimated',
      reason: latestState?.reason ?? latestState?.status ?? 'missing-input',
      currentState: latestState?.status ?? 'missing-input',
      currentFinite: Number.isFinite(last?.[meta.field]) && (meta.id !== 'statisticalCenter' || ready),
      missingSource: meta.sourceField,
      points,
    }
  })
}

function vwapLabel(state) {
  const source = state?.source
  const kind = typeof source === 'object' ? source?.kind : source
  return kind === 'amount-volume' ? '成交额 / 成交量重心' : 'HLC3 成交量重心代理'
}
