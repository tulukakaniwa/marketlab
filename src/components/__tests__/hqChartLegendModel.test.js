import { describe, expect, it } from 'vitest'
import { buildHqChartLegend } from '../hqChartLegendModel.js'

describe('HQ shared hover legend model', () => {
  it('只读取 domain series，并生成与 Light 图例相同的 OHLC/指标结构', () => {
    const rows = [
      { date: '2026-08-06', open: 9, high: 11, low: 8, close: 10, volume: 100 },
      { date: '2026-08-07', open: 10, high: 13, low: 9, close: 12, volume: 200 },
    ]
    const model = {
      groups: [
        {
          id: 'price',
          series: [
            {
              id: 'cost',
              label: '成本锚',
              color: '#0e7558',
              unit: 'price',
              points: [
                { time: '2026-08-06', value: 9.5 },
                { time: '2026-08-07', value: 10.5 },
              ],
            },
          ],
        },
        {
          id: 'carry',
          series: [
            {
              id: 'netCarry',
              label: '持仓归因代理',
              color: '#0e7558',
              unit: 'pct',
              points: [{ time: '2026-08-07', value: 0.0123 }],
            },
          ],
        },
      ],
    }

    const legend = buildHqChartLegend({ rows, model, index: 1 })

    expect(legend.ohlcv).toMatchObject({ close: 12, change: 2, changePct: 0.2, direction: 'up' })
    expect(legend.indicators.flatMap((group) => group.items)).toEqual([
      expect.objectContaining({ key: 'cost', value: 10.5, unit: 'price' }),
      expect.objectContaining({ key: 'netCarry', value: 0.0123, unit: 'pct' }),
    ])
  })

  it('没有有效游标时回退到最后一根 K 线', () => {
    const rows = [{ date: '2026-08-07', open: 10, high: 11, low: 9, close: 10, volume: 1 }]
    expect(buildHqChartLegend({ rows, model: { groups: [] } }).date).toBe('2026-08-07')
  })
})
