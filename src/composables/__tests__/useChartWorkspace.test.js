import { effectScope, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChartWorkspace } from '../useChartWorkspace.js'

beforeEach(() => window.localStorage.clear())
const vela = { name: 'FakeVela' }

function create(options = {}) {
  const scope = effectScope()
  const model = scope.run(() =>
    useChartWorkspace({
      loadVelaComponent: async () => ({ default: vela }),
      ...options,
    }),
  )
  return { scope, model }
}

async function settle() {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

describe('chart workspace single-engine Vela lifecycle', () => {
  it('loads Vela as the sole main workspace engine', async () => {
    const load = vi.fn(async () => ({ default: vela }))
    const { model, scope } = create({ loadVelaComponent: load })
    await settle()
    expect(model.engine.value).toBe('vela')
    expect(model.activeComponent.value).toBe(vela)
    model.confirmReady()
    expect(model.fallbackError.value).toBe('')
    expect(load).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('exposes a recoverable startup error and retries cleanly', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Vela unavailable')).mockResolvedValue({ default: vela })
    const { model, scope } = create({ loadVelaComponent: load })
    await settle()
    expect(model.loading.value).toBe(false)
    expect(model.activeComponent.value).toBeNull()
    expect(model.fallbackError.value).toContain('Vela unavailable')
    await model.retry()
    model.confirmReady()
    expect(model.activeComponent.value).toBe(vela)
    expect(model.fallbackError.value).toBe('')
    expect(load).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it('captures runtime paint failure and clears component until retry', async () => {
    const { model, scope } = create()
    await settle()
    model.confirmReady()
    model.fallback(new Error('paint failure'))
    expect(model.activeComponent.value).toBeNull()
    expect(model.fallbackError.value).toContain('paint failure')
    scope.stop()
  })
})
