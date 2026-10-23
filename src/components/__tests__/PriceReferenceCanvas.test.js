import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PriceReferenceCanvas from '../PriceReferenceCanvas.vue'
import { paintPriceReferenceMap } from '../../infrastructure/charting/priceReferencePainter.js'

vi.mock('../../infrastructure/charting/priceReferencePainter.js', () => ({ paintPriceReferenceMap: vi.fn() }))
afterEach(() => vi.restoreAllMocks())

it('draws the shared snapshot at period endpoints, retaining invalid gaps and clearing stale data', async () => {
  const ctx = { setTransform: vi.fn() }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx)
  const path = [
    { date: '2026-10-02', status: 'ready' },
    { date: '2026-10-03', status: 'ready' },
    { date: '2026-10-04', status: 'invalid-data' },
    { date: '2026-10-09', status: 'ready' },
  ]
  const viewport = {
    width: 800,
    height: 400,
    pixelRatio: 2,
    hasDate: (date) => ['2026-10-02', '2026-10-09'].includes(date),
  }
  const wrapper = mount(PriceReferenceCanvas, { props: { snapshot: { path }, viewport } })
  expect(wrapper.find('canvas').attributes('width')).toBe('1600')
  expect(wrapper.find('canvas').attributes('height')).toBe('800')
  expect(ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0)
  expect(paintPriceReferenceMap).toHaveBeenLastCalledWith(
    ctx,
    expect.objectContaining({ path: [path[0], path[2], path[3]] }),
  )
  await wrapper.setProps({ snapshot: null })
  expect(paintPriceReferenceMap).toHaveBeenLastCalledWith(ctx, expect.objectContaining({ path: [] }))
  await wrapper.setProps({ snapshot: { path }, dark: true })
  expect(paintPriceReferenceMap).toHaveBeenLastCalledWith(ctx, expect.objectContaining({ dark: true }))
  wrapper.unmount()
})
