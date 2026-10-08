import { effectScope, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChartWorkspace } from '../useChartWorkspace.js'

beforeEach(() => window.localStorage.clear())
const vela = { name: 'FakeVela' },
  hq = { name: 'FakeHq' }
function create(options = {}) {
  const scope = effectScope()
  const model = scope.run(() =>
    useChartWorkspace({
      loadVelaComponent: async () => ({ default: vela }),
      loadHqComponent: async () => ({ default: hq }),
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

describe('chart workspace migration and recovery', () => {
  it('migrates the persisted old engine and commits a switch only after first paint', async () => {
    localStorage.setItem('lab.chartEngine.v1', JSON.stringify('lightweight'))
    const load = vi.fn(async () => ({ default: hq }))
    const { model, scope } = create({ loadHqComponent: load })
    await settle()
    expect(model.engine.value).toBe('vela')
    expect(model.activeComponent.value).toBe(vela)
    model.confirmReady('vela')
    await model.selectEngine('hqchart')
    expect(model.displayEngine.value).toBe('hqchart')
    expect(model.engine.value).toBe('vela')
    model.confirmReady('vela')
    expect(model.engine.value).toBe('vela')
    model.confirmReady('hqchart')
    expect(model.engine.value).toBe('hqchart')
    await model.selectEngine('hqchart')
    expect(load).toHaveBeenCalledOnce()
    scope.stop()
  })
  it('keeps the last ready engine on chunk failure and retries the actual failed engine', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('HQ chunk unavailable')).mockResolvedValue({ default: hq })
    const { model, scope } = create({ loadHqComponent: load })
    await settle()
    model.confirmReady('vela')
    await model.selectEngine('hqchart')
    expect(model.engine.value).toBe('vela')
    expect(model.fallbackError.value).toContain('HQ chunk unavailable')
    expect(model.loading.value).toBe(false)
    await model.retry()
    expect(load).toHaveBeenCalledTimes(2)
    model.confirmReady('hqchart')
    expect(model.engine.value).toBe('hqchart')
    expect(model.fallbackError.value).toBe('')
    scope.stop()
  })
  it('ignores a canceled asynchronous load failure', async () => {
    let rejectLoad
    const { model, scope } = create({
      loadHqComponent: () =>
        new Promise((_resolve, reject) => {
          rejectLoad = reject
        }),
    })
    await settle()
    model.confirmReady('vela')
    const pending = model.selectEngine('hqchart')
    await model.selectEngine('vela')
    rejectLoad(new Error('late failure'))
    await pending
    expect(model.engine.value).toBe('vela')
    expect(model.displayEngine.value).toBe('vela')
    expect(model.fallbackError.value).toBe('')
    scope.stop()
  })
  it('exposes a recoverable startup error when no engine has painted yet', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Vela unavailable')).mockResolvedValue({ default: vela })
    const { model, scope } = create({ loadVelaComponent: load })
    await settle()
    expect(model.loading.value).toBe(false)
    expect(model.activeComponent.value).toBeNull()
    expect(model.fallbackError.value).toContain('Vela unavailable')
    await model.retry()
    model.confirmReady('vela')
    expect(model.activeComponent.value).toBe(vela)
    expect(model.fallbackError.value).toBe('')
    scope.stop()
  })
  it('drops a failed candidate and restores the prior ready HQ engine', async () => {
    localStorage.setItem('lab.chartEngine.v1', JSON.stringify('hqchart'))
    const { model, scope } = create()
    await settle()
    model.confirmReady('hqchart')
    await model.selectEngine('vela')
    model.fallback(new Error('paint failure'), 'vela')
    expect(model.activeComponent.value).toBe(hq)
    expect(model.engine.value).toBe('hqchart')
    expect(model.failedEngine.value).toBe('vela')
    expect(model.fallbackError.value).toContain('paint failure')
    scope.stop()
  })
})
