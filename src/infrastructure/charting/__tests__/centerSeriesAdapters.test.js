import { describe, expect, it } from 'vitest'
import { queryMarketLabChartSeries } from '../../../domain/research-visualization/marketLabChartIndicators.js'
import { buildVelaResearchGroups } from '../velaResearchAdapter.js'
import { hqResearchApiId, toHqResearchIndexResponse } from '../hqChartResearchAdapter.js'

const rows = [
  { date: '2026-10-01', close: 100 },
  { date: '2026-10-02', close: 110 },
  { date: '2026-10-03', close: 120 },
]

describe('center series charting adapters', () => {
  it('maps unidentified statistical centers to null Vela points and omits empty HQ series', () => {
    const empty = queryMarketLabChartSeries({
      rows,
      centerPath: rows.map((row) => ({
        date: row.date,
        statisticalCenterPrice: null,
        centerStates: { statisticalCenter: { status: 'unidentified', reason: 'unit-root-not-rejected' } },
      })),
    })
    const native = buildVelaResearchGroups(empty, 'lab').find(
      ({ centerFormula }) => centerFormula === 'statisticalCenter',
    )
    expect(native.title).toBe('统计回归中心')
    expect(native.output.series[0].points.every(({ value }) => value === null)).toBe(true)
    const hq = toHqResearchIndexResponse(empty, hqResearchApiId('price'))
    expect(hq.outdata.outvar.some(({ name }) => name === '统计回归中心')).toBe(false)
  })

  it('maps point-rendered parameter scenarios to sparse circle series in Vela', () => {
    const centerPath = rows.slice(0, 2).map((row, index) => ({
      date: row.date,
      supplyDemandPrice: 80 + index,
      fundamentalPrice: 70 + index,
    }))
    const model = queryMarketLabChartSeries({
      rows,
      centerPath,
      overlays: { supplyDemand: true, fundamental: true, priceBands: false },
    })
    for (const id of ['supplyDemand', 'fundamental']) {
      const native = buildVelaResearchGroups(model, 'lab').find(({ centerFormula }) => centerFormula === id)
      expect(native.output.series[0].kind).toBe('circles')
      expect(native.output.series[0].points.map(({ value }) => value)).toEqual([
        null,
        centerPath[1][`${id}Price`],
        null,
      ])
    }
  })
})
