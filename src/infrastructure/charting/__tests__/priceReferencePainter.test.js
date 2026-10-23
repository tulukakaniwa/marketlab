import { describe, expect, it, vi } from 'vitest'
import { paintPriceReferenceMap } from '../priceReferencePainter.js'

function context() {
  const ctx = Object.fromEntries(
    ['save', 'restore', 'beginPath', 'closePath', 'rect', 'clip', 'moveTo', 'lineTo', 'arc', 'stroke'].map((key) => [
      key,
      vi.fn(),
    ]),
  )
  ctx.fill = vi.fn(() => ({ color: ctx.fillStyle, alpha: ctx.globalAlpha }))
  return ctx
}
const node = { price: 50, intensity: 1, side: 'above', isPoc: true }
const point = (date, overrides = {}) => ({ date, status: 'ready', nodes: [node], ...overrides })
const options = {
  path: [point(10), point(20), point(30)],
  costPath: [10, 20, 30, 40].map((date) => ({ date, lower: 40, upper: 60 })),
  projectX: (date) => date,
  projectY: (price) => 100 - price,
  bounds: { left: 0, top: 0, width: 100, height: 100 },
  barSpacing: 10,
}

describe('shared price reference map painter', () => {
  it('clips to the price pane and draws only historical nodes and cost-band intervals', () => {
    const ctx = context()
    paintPriceReferenceMap(ctx, options)
    expect(ctx.rect).toHaveBeenCalledExactlyOnceWith(0, 0, 100, 100)
    expect(ctx.clip).toHaveBeenCalledOnce()
    expect(ctx.moveTo.mock.calls).toEqual([
      [10, 40],
      [20, 40],
    ])
    expect(ctx.arc.mock.calls.map(([x]) => x)).toEqual([30, 20, 10])
    expect(ctx.lineTo.mock.calls.every(([x]) => x <= 30)).toBe(true)
    expect(ctx.restore).toHaveBeenCalledOnce()
  })
  it('breaks the band at unavailable model observations and invalid cost bounds', () => {
    const ctx = context()
    const path = [
      point(10),
      point(20, { status: 'unavailable' }),
      point(30),
      point(40),
      point(50),
      point(60),
      point(70),
    ]
    const costPath = [10, 20, 30, 40, 50, 60, 70].map((date) => ({ date, lower: 40, upper: 60 }))
    costPath[4].lower = null
    paintPriceReferenceMap(ctx, { ...options, path, costPath })
    expect(ctx.moveTo.mock.calls).toEqual([
      [30, 40],
      [60, 40],
    ])
    expect(ctx.arc.mock.calls.some(([x]) => x === 20)).toBe(false)
  })
  it.each([
    { date: 20, lower: 70, upper: 90 },
    { date: 20, lower: null, upper: null },
  ])('preserves the earlier cost-band geometry after an invalid duplicate date: %j', (duplicateCost) => {
    const original = context(),
      appended = context()
    const path = [point(10), point(20)]
    const costPath = [
      { date: 10, lower: 40, upper: 60 },
      { date: 20, lower: 45, upper: 65 },
    ]
    paintPriceReferenceMap(original, { ...options, path, costPath })
    paintPriceReferenceMap(appended, {
      ...options,
      path: [...path, point(20, { status: 'invalid-data', nodes: [] })],
      costPath: [...costPath, duplicateCost],
    })
    expect(original.moveTo).toHaveBeenCalledExactlyOnceWith(10, 40)
    expect(original.lineTo.mock.calls).toEqual([
      [20, 35],
      [20, 55],
      [10, 60],
    ])
    expect(appended.moveTo.mock.calls).toEqual(original.moveTo.mock.calls)
    expect(appended.lineTo.mock.calls).toEqual(original.lineTo.mock.calls)
    expect(appended.arc.mock.calls).toEqual(original.arc.mock.calls)
    expect(appended.fill.mock.results).toEqual(original.fill.mock.results)
  })
  it('scales dot area from intensity and distinguishes price sides without changing supplied levels', () => {
    const ctx = context()
    const nodes = [node, { ...node, price: 25, intensity: 0.25, side: 'below', isPoc: false }]
    paintPriceReferenceMap(ctx, { ...options, path: [point(10, { nodes })], costPath: [] })
    const [[x, y, large], [smallX, smallY, small]] = ctx.arc.mock.calls
    expect([x, y, smallX, smallY]).toEqual([10, 50, 10, 75])
    expect(large ** 2 / small ** 2).toBeCloseTo(4)
    expect(ctx.fill.mock.results.map(({ value }) => value.color)).toEqual(['#b47e17', '#24899c'])
    expect(ctx.stroke).toHaveBeenCalledOnce()
    expect(nodes[1]).toEqual({ ...node, price: 25, intensity: 0.25, side: 'below', isPoc: false })
  })
  it('limits screen density when zoomed out while retaining the newest visible observation', () => {
    const ctx = context()
    const path = Array.from({ length: 1000 }, (_, i) => point(i))
    paintPriceReferenceMap(ctx, { ...options, path, projectX: (date) => date / 10, barSpacing: 0.1 })
    const xs = ctx.arc.mock.calls.map(([x]) => x)
    expect(xs[0]).toBe(99.9)
    expect(xs.length).toBeLessThanOrEqual(15)
    expect(xs.slice(1).every((x, i) => xs[i] - x >= 7)).toBe(true)
    expect(path).toHaveLength(1000)
  })
  it('does not paint hidden, empty, invalid or out-of-pane dots', () => {
    const ctx = context()
    paintPriceReferenceMap(ctx, { ...options, enabled: false })
    paintPriceReferenceMap(ctx, { ...options, path: [] })
    expect(ctx.save).not.toHaveBeenCalled()
    paintPriceReferenceMap(ctx, {
      ...options,
      costPath: [],
      path: [
        point(-20),
        point(110),
        point(20, {
          nodes: [
            { ...node, intensity: NaN },
            { ...node, intensity: 0 },
            { ...node, price: null },
            { ...node, price: 200 },
          ],
        }),
      ],
    })
    expect(ctx.arc).not.toHaveBeenCalled()
  })
})
