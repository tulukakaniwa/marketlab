import { describe, expect, it } from 'vitest'
import { toVelaTime, toVelaTimeframe, toVelaBars, toVelaSeries, buildVelaHostOutput } from '../velaResearchAdapter.js'

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
  it('preserves intraday instants and refuses ambiguous local timestamps', () => {
    const time = Date.UTC(2026, 9, 23, 12, 45)
    expect(toVelaTime('2026-10-23T12:45:00.000Z')).toBe(time)
    expect(toVelaTime('2026-10-23T20:45:00+08:00')).toBe(time)
    expect(toVelaTime('2026-10-23T12:45:00')).toBeNaN()
    expect(toVelaTime(null)).toBeNaN()
    expect(toVelaBars([{ date: '2026-10-23T12:45:00.000Z', close: 2500 }])[0].time).toBe(time)
    expect(toVelaTimeframe('5m')).toBe('5')
    expect(toVelaTimeframe('1h')).toBe('60')
    expect(toVelaTimeframe('240')).toBe('240')
    expect(toVelaTimeframe('1d')).toBe('1D')
    expect(toVelaTimeframe()).toBe('1D')
    expect(() => toVelaTimeframe('unknown')).toThrow('不支持')
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
  it('uses explicit dated research hints only for autoscaling, with earlier dates left empty', () => {
    const rows = [
      { date: '2026-10-23T12:35:00.000Z', close: 2400 },
      { date: '2026-10-23T12:40:00.000Z', close: 2401 },
    ]
    const input = { rows, markers: [], costPath: [], overlays: {} }
    expect(buildVelaHostOutput(input, 'lab').series).toHaveLength(1)
    const output = buildVelaHostOutput(
      { ...input, priceScaleHints: [{ date: rows[1].date, min: 2300, max: 2600 }] },
      'lab',
    )
    const hints = output.series.slice(1)
    expect(hints).toHaveLength(2)
    expect(hints.map((series) => series.points.map((point) => point.value))).toEqual([
      [null, 2300],
      [null, 2600],
    ])
    for (const series of hints)
      expect(series.display).toEqual({ pane: false, priceScale: true, legend: false, dataWindow: false })
    expect(buildVelaHostOutput({ ...input, priceScaleHints: [] }, 'lab').series).toHaveLength(1)
  })
})
