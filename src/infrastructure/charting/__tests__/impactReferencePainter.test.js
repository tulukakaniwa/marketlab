import { describe, expect, it, vi } from 'vitest'
import { paintImpactReferenceMap } from '../impactReferencePainter.js'

function context() {
  const ctx = Object.fromEntries(
    ['save', 'restore', 'beginPath', 'closePath', 'rect', 'clip', 'moveTo', 'lineTo', 'arc', 'setLineDash'].map(
      (key) => [key, vi.fn()],
    ),
  )
  for (const key of ['fill', 'stroke', 'fillRect', 'fillText']) {
    ctx[key] = vi.fn(() => ({ color: key === 'stroke' ? ctx.strokeStyle : ctx.fillStyle, alpha: ctx.globalAlpha }))
  }
  ctx.measureText = vi.fn((text) => ({ width: text.length * 5 }))
  return ctx
}

const lp = { id: 'pool-lower', kind: 'lp', price: 50, intensity: 1, label: '区间下界' }
const option = { id: 'strike', kind: 'options', price: 25, intensity: 0.25, label: '执行价' }
const point = (date, overrides = {}) => ({ date, status: 'ready', nodes: [lp], ...overrides })
const config = {
  snapshot: { path: [point(10), point(20), point(30)] },
  projectX: (date) => date,
  projectY: (price) => 100 - price,
  bounds: { left: 0, top: 0, width: 120, height: 100 },
  barSpacing: 10,
}

describe('market impact reference painter', () => {
  it('clips points and connects only adjacent approved snapshots without extending levels', () => {
    const ctx = context()
    paintImpactReferenceMap(ctx, config)
    expect(ctx.rect).toHaveBeenCalledExactlyOnceWith(0, 0, 120, 100)
    expect(ctx.clip).toHaveBeenCalledOnce()
    expect(ctx.moveTo.mock.calls).toEqual([
      [10, 50],
      [20, 50],
    ])
    expect(ctx.lineTo.mock.calls).toEqual([
      [20, 50],
      [30, 50],
    ])
    expect(ctx.setLineDash.mock.calls).toEqual([[[2, 4]], [[]]])
    expect(ctx.arc.mock.calls.map(([x]) => x)).toEqual([30, 10])
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(['LP 50'])
    expect(ctx.restore).toHaveBeenCalledOnce()
  })

  it('breaks continuity at unavailable rows, absent nodes, duplicate coordinates and source changes', () => {
    const ctx = context()
    const path = [
      point(10),
      point(20, { status: 'unavailable' }),
      point(30),
      point(40, { nodes: [] }),
      point(50),
      point(60, { nodes: [{ ...lp, kind: 'options' }] }),
      point(70),
      point(70),
      point(80),
    ]
    paintImpactReferenceMap(ctx, { ...config, snapshot: { path } })
    // Diamond geometry is excluded here; only strokes with the dashed connection style count.
    expect(ctx.moveTo.mock.calls.slice(0, 1)).toEqual([[70, 50]])
    expect(ctx.lineTo.mock.calls.slice(0, 1)).toEqual([[80, 50]])
    expect(ctx.stroke.mock.results.filter(({ value }) => value.alpha === 0.28)).toHaveLength(1)
  })

  it('distinguishes sources by shape and color while keeping area proportional to supplied strength', () => {
    const ctx = context()
    const snapshot = { path: [point(20, { nodes: [lp, option] })] }
    const original = structuredClone(snapshot)
    paintImpactReferenceMap(ctx, { ...config, snapshot })
    const [[x, y, radius]] = ctx.arc.mock.calls
    const [[diamondX, diamondTop]] = ctx.moveTo.mock.calls
    const [[diamondRight, diamondY]] = ctx.lineTo.mock.calls
    expect([x, y, diamondX, diamondY]).toEqual([20, 50, 20, 75])
    expect((Math.PI * radius ** 2) / (2 * (diamondRight - diamondX) * (diamondY - diamondTop))).toBeCloseTo(4)
    expect(ctx.fill.mock.results.map(({ value }) => value.color)).toEqual(['#ad7919', '#7957b1'])
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(['LP 50', '期权 25'])
    expect(snapshot).toEqual(original)
  })

  it('does not join a temporarily absent node even while other nodes keep the snapshot ready', () => {
    const ctx = context()
    const snapshot = {
      path: [point(10, { nodes: [lp, option] }), point(20, { nodes: [option] }), point(30, { nodes: [lp, option] })],
    }
    paintImpactReferenceMap(ctx, { ...config, snapshot })
    expect(ctx.moveTo.mock.calls.slice(0, 2)).toEqual([
      [10, 75],
      [20, 75],
    ])
    expect(ctx.lineTo.mock.calls.slice(0, 2)).toEqual([
      [20, 75],
      [30, 75],
    ])
    expect(ctx.stroke.mock.results.filter(({ value }) => value.alpha === 0.28)).toHaveLength(2)
  })

  it('labels only the latest visible snapshot, de-duplicates prices and avoids overlapping labels', () => {
    const ctx = context()
    const path = [
      point(10, { nodes: [{ ...lp, price: 60 }] }),
      point(30, { nodes: [lp, { ...lp, id: 'duplicate' }, { ...option, price: 49 }] }),
      point(130, { nodes: [{ ...lp, price: 99 }] }),
    ]
    paintImpactReferenceMap(ctx, { ...config, snapshot: { path } })
    expect(ctx.fillText.mock.calls.map(([text]) => text)).toEqual(['LP 50', '期权 49'])
    const labels = ctx.fillText.mock.calls
    expect(labels[1][2] - labels[0][2]).toBeGreaterThanOrEqual(15)
    expect(labels.every(([, x]) => x > 30)).toBe(true)
    expect(ctx.fillRect.mock.calls.every(([x, y, width, height]) => x + width <= 120 && y + height <= 100)).toBe(true)
  })

  it('omits labels without right margin instead of covering older candles', () => {
    const ctx = context()
    paintImpactReferenceMap(ctx, { ...config, snapshot: { path: [point(115)] } })
    expect(ctx.arc).toHaveBeenCalledOnce()
    expect(ctx.fillText).not.toHaveBeenCalled()
  })

  it('samples dense data in screen space and retains the newest visible observation', () => {
    const ctx = context()
    const path = Array.from({ length: 1000 }, (_, i) => point(i))
    paintImpactReferenceMap(ctx, {
      ...config,
      snapshot: { path },
      projectX: (date) => date / 10,
      barSpacing: 0.1,
    })
    const xs = ctx.arc.mock.calls.map(([x]) => x)
    expect(xs[0]).toBe(99.9)
    expect(xs.length).toBeLessThanOrEqual(12)
    expect(xs.slice(1).every((x, i) => xs[i] - x >= 9)).toBe(true)
    expect(path).toHaveLength(1000)
  })

  it('ignores hidden, empty or invalid panes and invalid node values', () => {
    const ctx = context()
    paintImpactReferenceMap(ctx, { ...config, enabled: false })
    paintImpactReferenceMap(ctx, { ...config, snapshot: { path: [] } })
    paintImpactReferenceMap(ctx, { ...config, snapshot: null })
    paintImpactReferenceMap(ctx, { ...config, bounds: { ...config.bounds, left: NaN } })
    expect(ctx.save).not.toHaveBeenCalled()
    paintImpactReferenceMap(ctx, {
      ...config,
      snapshot: {
        path: [
          point(-20),
          point(130),
          point(20, {
            nodes: [
              { ...lp, intensity: NaN },
              { ...lp, intensity: 0 },
              { ...lp, price: 0 },
              { ...lp, price: 200 },
              { ...lp, kind: 'unknown' },
              { ...lp, id: null },
              null,
            ],
          }),
        ],
      },
    })
    expect(ctx.arc).not.toHaveBeenCalled()
    expect(ctx.fillText).not.toHaveBeenCalled()
  })

  it('skips failed coordinate projections and restores the context on the dark theme', () => {
    const ctx = context()
    const projectX = (date) => {
      if (date === 20) throw new Error('missing bar')
      return date === 30 ? NaN : date
    }
    paintImpactReferenceMap(ctx, {
      ...config,
      snapshot: { path: [point(10), point(20), point(30), point(40)] },
      projectX,
      dark: true,
    })
    expect(ctx.moveTo).not.toHaveBeenCalled()
    expect(ctx.arc.mock.calls.map(([x]) => x)).toEqual([40, 10])
    expect(ctx.fill.mock.results.every(({ value }) => value.color === '#efbf65')).toBe(true)
    expect(ctx.restore).toHaveBeenCalledOnce()
  })
})
