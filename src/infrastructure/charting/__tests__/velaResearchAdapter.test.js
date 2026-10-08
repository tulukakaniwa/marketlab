import { describe, expect, it } from 'vitest'
import { toVelaTime, toVelaBars, toVelaSeries, buildVelaHostOutput } from '../velaResearchAdapter.js'

describe('Vela date and visual boundary', () => {
  it('aligns market dates and all existing drawing time formats without timezone drift', () => {
    const ms = Date.UTC(2026, 9, 8)
    expect(toVelaTime('2026-10-08')).toBe(ms)
    expect(toVelaTime(ms / 1000)).toBe(ms)
    expect(toVelaTime({ year: 2026, month: 10, day: 8 })).toBe(ms)
    const row = { date: '2026-10-08', open: 8, high: 10, low: 7, close: 9, volume: 120 }
    expect(toVelaBars([row])).toEqual([{ time: ms, open: 8, high: 10, low: 7, close: 9, volume: 120 }])
  })
  it('keeps a middle gap explicit instead of connecting sparse points', () => {
    const dates = ['2026-10-01', '2026-10-02', '2026-10-03']
    const series = toVelaSeries(
      {
        id: 'causal',
        label: '均衡',
        color: '#a855f7',
        points: [
          { time: dates[0], value: 10 },
          { time: dates[2], value: 12 },
        ],
      },
      dates,
      'lab',
    )
    expect(series.points.map((point) => point.value)).toEqual([10, null, 12])
  })
  it('preserves marker semantics and never manufactures a cost state without inputs', () => {
    const rows = [{ date: '2026-10-08', close: 9 }]
    const marker = { time: rows[0].date, position: 'belowBar', shape: 'arrowUp', color: '#0e7558', text: 'B' }
    const input = { rows, markers: [marker], costPath: [], overlays: { regime: true } }
    const output = buildVelaHostOutput(input, 'lab')
    expect(output.backgrounds).toEqual([])
    expect(output.series[0].markers).toEqual([{ ...marker, time: Date.UTC(2026, 9, 8), size: 'small' }])
    const colored = buildVelaHostOutput({ ...input, costPath: [{ date: rows[0].date, upper: 8, lower: 6 }] }, 'lab')
    expect(colored.backgrounds[0]).toMatchObject({
      from: Date.UTC(2026, 9, 8),
      to: Date.UTC(2026, 9, 9),
      color: 'rgba(169,50,38,0.45)',
    })
  })
})
