import { afterEach, describe, expect, it, vi } from 'vitest'
import { readHqPriceReferenceViewport } from '../hqPriceReferenceViewport.js'

afterEach(() => vi.restoreAllMocks())
function fixture(dates = [20261001, 20261002, 20261003, 20261004]) {
  const frame = {
    XPointCount: 8,
    HorizontalMin: 80,
    HorizontalMax: 120,
    GetBorder: () => ({ LeftEx: 20, RightEx: 620, TopEx: 40, BottomEx: 440, ChartWidth: 800, ChartHeight: 600 }),
    GetXFromIndex: vi.fn((index) => 40 + index * 20),
    GetYFromData: vi.fn((price) => 440 - (Math.log(price / 80) / Math.log(120 / 80)) * 400),
  }
  const data = { Data: dates.map((Date) => ({ Date })), DataOffset: 1 }
  return {
    frame,
    data,
    chart: {
      JSChartContainer: {
        Period: 0,
        RightSpaceCount: 4,
        ChartPaint: [{ Data: data }],
        Frame: { SubFrame: [{ Frame: frame }] },
      },
    },
  }
}
describe('HQ reference map coordinates', () => {
  it('uses actual native X and unbounded log Y in CSS pixels, respecting pan and DPR', () => {
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(2)
    const { chart, frame } = fixture()
    const viewport = readHqPriceReferenceViewport(chart)
    expect(viewport).toMatchObject({
      width: 400,
      height: 300,
      pixelRatio: 2,
      barSpacing: 10,
      bounds: { left: 10, top: 20, width: 300, height: 200 },
    })
    expect(viewport.projectX('2026-10-02')).toBe(20)
    expect(viewport.projectX('2026-10-03')).toBe(30)
    expect(viewport.projectX('2026-10-05')).toBeNull()
    expect(viewport.projectY(100)).toBeCloseTo((440 - (Math.log(1.25) / Math.log(1.5)) * 400) / 2)
    expect(viewport.projectY(150)).toBeLessThan(20)
    expect(frame.GetYFromData).toHaveBeenLastCalledWith(150, false)
  })
  it('only maps period-end dates and changes signature after period, viewport or scale changes', () => {
    const { chart, frame, data } = fixture([20261002, 20261009, 20261016])
    const first = readHqPriceReferenceViewport(chart)
    expect(first.hasDate('2026-10-09')).toBe(true)
    expect(first.hasDate('2026-10-08')).toBe(false)
    expect(first.projectX('2026-10-08')).toBeNull()
    data.DataOffset = 0
    const panned = readHqPriceReferenceViewport(chart)
    expect(panned.signature).not.toBe(first.signature)
    chart.JSChartContainer.Period = 2
    const period = readHqPriceReferenceViewport(chart)
    expect(period.signature).not.toBe(panned.signature)
    frame.HorizontalMax = 150
    expect(readHqPriceReferenceViewport(chart).signature).not.toBe(period.signature)
  })
  it('rejects unavailable dimensions and native transforms', () => {
    expect(readHqPriceReferenceViewport(null)).toBeNull()
    const { chart, frame } = fixture()
    frame.GetXFromIndex = null
    expect(readHqPriceReferenceViewport(chart)).toBeNull()
  })
  it('does not move an earlier date to a later duplicate bar', () => {
    const { chart, data } = fixture([20261001, 20261002, 20261002])
    data.DataOffset = 0
    const viewport = readHqPriceReferenceViewport(chart)
    expect(viewport.projectX('2026-10-02')).toBe(60 / viewport.pixelRatio)
  })
})
