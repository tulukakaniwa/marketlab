import { describe, expect, it, vi } from 'vitest'
import { createVelaPriceReferenceLayer } from '../velaPriceReferenceLayer.js'

function mount(definition) {
  const ctx = Object.fromEntries(
    ['setTransform', 'clearRect', 'save', 'restore', 'beginPath', 'rect', 'clip', 'arc', 'stroke'].map((key) => [
      key,
      vi.fn(),
    ]),
  )
  ctx.fill = vi.fn(() => ctx.fillStyle)
  const canvas = { width: 200, height: 300, getContext: () => ctx }
  const layer = definition.create()
  layer.mount(canvas)
  return { layer, canvas, ctx }
}
const date = '2026-10-08'
function frame(enabled = true) {
  return {
    data: {
      enabled,
      referenceMap: { path: [{ date, status: 'ready', nodes: [{ price: 50, intensity: 1, side: 'below' }] }] },
    },
    bounds: { top: 30, height: 80 },
    scale: { min: 1, max: 100, log: true },
    theme: { background: '#ffffff' },
    coords: { dpr: 2, width: 100, timeToX: vi.fn(() => 40), priceToY: vi.fn(() => 70), pxPerBar: () => 12 },
  }
}

describe('Vela reference renderer layer', () => {
  it('uses official chart coordinates, pane bounds and device scale on every frame', () => {
    const onPaint = vi.fn()
    const { layer, ctx, canvas } = mount(
      createVelaPriceReferenceLayer({ id: 'chart-host', isDestroyed: () => false, onPaint }),
    )
    const args = frame()
    layer.render(args)
    expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, 200, 300)
    expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0)
    expect(ctx.rect).toHaveBeenLastCalledWith(0, 30, 100, 80)
    expect(args.coords.timeToX).toHaveBeenCalledWith(Date.UTC(2026, 9, 8))
    expect(args.coords.priceToY).toHaveBeenCalledWith(50, args.scale, args.bounds)
    expect(ctx.arc.mock.calls[0].slice(0, 2)).toEqual([40, 70])
    expect(ctx.fill).toHaveLastReturnedWith('#24899c')
    canvas.width = 400
    args.coords.width = 200
    args.theme.background = '#151619'
    layer.render(args)
    expect(ctx.clearRect).toHaveBeenLastCalledWith(0, 0, 400, 300)
    expect(ctx.rect).toHaveBeenLastCalledWith(0, 30, 200, 80)
    expect(ctx.fill).toHaveLastReturnedWith('#64bdc8')
    expect(onPaint).toHaveBeenCalledTimes(2)
  })
  it('isolates mounted charts by their channel payload and clears disabled, missing and destroyed frames', () => {
    let destroyed = false
    const onPaint = vi.fn()
    const definition = createVelaPriceReferenceLayer({ id: 'chart-host', isDestroyed: () => destroyed, onPaint })
    const first = mount(definition),
      second = mount(definition)
    first.layer.render(frame())
    second.layer.render({ ...frame(), data: undefined })
    expect(first.ctx.arc).toHaveBeenCalledOnce()
    expect(second.ctx.arc).not.toHaveBeenCalled()
    first.layer.render(frame(false))
    first.layer.render({ ...frame(), data: {} })
    expect(first.ctx.arc).toHaveBeenCalledOnce()
    expect(first.ctx.clearRect).toHaveBeenCalledTimes(3)
    destroyed = true
    first.layer.render(frame())
    expect(first.ctx.clearRect).toHaveBeenCalledTimes(4)
    expect(first.ctx.arc).toHaveBeenCalledOnce()
    first.layer.destroy()
    first.layer.render(frame())
    expect(first.ctx.clearRect).toHaveBeenCalledTimes(4)
  })
})
