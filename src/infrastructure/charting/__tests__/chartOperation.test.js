import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForChartOperation } from '../chartOperation.js'
afterEach(() => vi.useRealTimers())
describe('chart operation bounds', () => {
  it('cleans timers after success and rejects a stalled first paint', async () => {
    vi.useFakeTimers()
    await expect(waitForChartOperation(Promise.resolve('ready'))).resolves.toBe('ready')
    expect(vi.getTimerCount()).toBe(0)
    const operation = waitForChartOperation(new Promise(() => {}), { timeout: 10, label: 'Vela 首帧' })
    const result = expect(operation).rejects.toThrow('Vela 首帧等待超时')
    await vi.advanceTimersByTimeAsync(10)
    await result
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancels startup without waiting for an unresolved upstream promise', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const operation = waitForChartOperation(new Promise(() => {}), { signal: controller.signal })
    controller.abort()
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
