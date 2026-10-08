import { describe, expect, it } from 'vitest'
import { queryMarketLabChartSeries } from '../research-visualization/marketLabChartIndicators.js'
import { buildVelaResearchGroups } from '../../infrastructure/charting/velaResearchAdapter.js'
import { hqResearchApiId, toHqResearchIndexResponse } from '../../infrastructure/charting/hqChartResearchAdapter.js'

const rows = [
  { date: '2026-10-01', close: 100 },
  { date: '2026-10-02', close: 110 },
  { date: '2026-10-03', close: 120 },
]
const series = (model, id) => model.groups[0].series.find((item) => item.id === id)

describe('independent center chart query', () => {
  it('retains native settings for unidentified statistics, paints nulls, and reports current status despite historical ready values', () => {
    const centerPath = rows.map((row, index) => ({
      date: row.date,
      statisticalCenterPrice: 105,
      centerStates: {
        statisticalCenter: { status: index === 1 ? 'ready' : 'unidentified', reason: 'unit-root-not-rejected' },
      },
    }))
    const model = queryMarketLabChartSeries({ rows, centerPath })
    expect(series(model, 'statisticalCenter').points).toEqual([{ time: rows[1].date, value: 105 }])
    expect(model.controls.statisticalCenter).toMatchObject({
      state: 'unidentified',
      current: true,
      historicalOutputCount: 1,
    })
    const empty = queryMarketLabChartSeries({
      rows,
      centerPath: centerPath.map((row) => ({ ...row, statisticalCenterPrice: null })),
    })
    expect(series(empty, 'statisticalCenter').points).toEqual([])
    const native = buildVelaResearchGroups(empty, 'lab').find(
      ({ centerFormula }) => centerFormula === 'statisticalCenter',
    )
    expect(native.title).toBe('统计回归中心')
    expect(native.output.series[0].points.every(({ value }) => value === null)).toBe(true)
    const hq = toHqResearchIndexResponse(empty, hqResearchApiId('price'))
    expect(hq.outdata.outvar.some(({ name }) => name === '统计回归中心')).toBe(false)
  })
  it('uses each explicit center field, labels HLC3 proxy versus actual amount/volume, and does not backfill parameter scenarios', () => {
    const centerPath = rows.slice(0, 2).map((row, index) => ({
      date: row.date,
      vwapCostPrice: 100 + index,
      cohortCostPrice: 90 + index,
      supplyDemandPrice: 80 + index,
      fundamentalPrice: 70 + index,
      centerStates: { vwapCost: { status: 'ready', source: { kind: 'amount-volume' } } },
    }))
    const model = queryMarketLabChartSeries({
      rows,
      centerPath,
      overlays: { cohortCost: true, supplyDemand: true, fundamental: true, priceBands: false },
    })
    expect(series(model, 'vwapCost').label).toBe('成交额 / 成交量重心')
    expect(series(model, 'vwapCost').points).toEqual(
      centerPath.map((row) => ({ time: row.date, value: row.vwapCostPrice })),
    )
    expect(series(model, 'cohortCost').points).toEqual(
      centerPath.map((row) => ({ time: row.date, value: row.cohortCostPrice })),
    )
    for (const id of ['supplyDemand', 'fundamental']) {
      expect(series(model, id).points).toEqual([{ time: rows[1].date, value: centerPath[1][`${id}Price`] }])
      const native = buildVelaResearchGroups(model, 'lab').find(({ centerFormula }) => centerFormula === id)
      expect(native.output.series[0].kind).toBe('circles')
      expect(native.output.series[0].points.map(({ value }) => value)).toEqual([
        null,
        centerPath[1][`${id}Price`],
        null,
      ])
    }
    const proxy = queryMarketLabChartSeries({
      rows,
      centerPath: [
        {
          date: rows[0].date,
          vwapCostPrice: 100,
          centerStates: { vwapCost: { status: 'ready', source: { kind: 'hlc3-volume' } } },
        },
      ],
    })
    expect(series(proxy, 'vwapCost').label).toBe('HLC3 成交量重心代理')
  })
  it('centers stay independent of price band groups and missing scenarios never become zero lines', () => {
    const model = queryMarketLabChartSeries({
      rows,
      centerPath: [],
      overlays: { statisticalCenter: false, vwapCost: true, supplyDemand: true, priceBands: false },
    })
    expect(series(model, 'statisticalCenter')).toBeUndefined()
    expect(series(model, 'vwapCost').points).toEqual([])
    expect(series(model, 'supplyDemand').points).toEqual([])
    expect(model.controls.supplyDemand).toMatchObject({ state: 'missing-input', active: true, outputCount: 0 })
    expect(
      buildVelaResearchGroups(model, 'lab')
        .find(({ centerFormula }) => centerFormula === 'supplyDemand')
        .output.series[0].points.every(({ value }) => value === null),
    ).toBe(true)
  })
})
