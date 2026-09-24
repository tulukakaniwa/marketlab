import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCausalModel } from '../useCausalModel.js'

function row(date, close = 100) {
  return { date, open: close, high: close + 1, low: close - 1, close, volume: 100 }
}
function result(rows) {
  return { status: 'ready', asOfDate: rows.at(-1)?.date, futureRowsUsed: false }
}

describe('useCausalModel prefix query scheduling', () => {
  let scope
  beforeEach(() => {
    vi.useFakeTimers()
    scope = effectScope()
  })
  afterEach(() => {
    scope.stop()
    vi.useRealTimers()
  })

  function setup(query, initialRows = [row('2026-01-01')], tdpy = 252) {
    const rows = ref(initialRows)
    const tradingDays = ref(tdpy)
    const source = ref('asset-a')
    const model = scope.run(() => useCausalModel(rows, tradingDays, source, query))
    return { ...model, rows, tradingDays, source }
  }

  it('缺历史或年会话数时清空结果，不安排无输入查询', async () => {
    const query = vi.fn(({ rows }) => result(rows))
    const model = setup(query, [])
    await vi.runAllTimersAsync()
    expect(query).not.toHaveBeenCalled()
    expect(model.queryState.value.reason).toBe('missing-data')
    model.rows.value = [row('2026-01-01')]
    await vi.runAllTimersAsync()
    expect(model.snapshot.value.status).toBe('ready')
    model.tradingDays.value = null
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value.reason).toBe('missing-tdpy')
    await vi.runAllTimersAsync()
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('cursor 切换立即清空旧日期，合并连续切换并仅传当前前缀与年会话数', async () => {
    const query = vi.fn(({ rows }) => result(rows))
    const model = setup(query)
    await vi.runAllTimersAsync()
    expect(model.snapshot.value.asOfDate).toBe('2026-01-01')
    model.rows.value = [row('2026-01-01'), row('2026-01-02')]
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value.asOfDate).toBe('2026-01-02')
    model.rows.value = [row('2026-01-01'), row('2026-01-02'), row('2026-01-03')]
    await vi.runAllTimersAsync()
    expect(query).toHaveBeenCalledTimes(2)
    expect(Object.keys(query.mock.calls[1][0])).toEqual(['rows', 'tradingDaysPerYear'])
    expect(query.mock.calls[1][0].rows).toHaveLength(3)
    expect(model.snapshot.value.asOfDate).toBe('2026-01-03')
  })

  it('更换来源后晚完成的旧请求不得写入新标的', async () => {
    const pending = []
    const query = vi.fn(({ rows }) => new Promise((resolve) => pending.push(() => resolve(result(rows)))))
    const model = setup(query)
    await vi.advanceTimersByTimeAsync(0)
    model.source.value = 'asset-b'
    model.rows.value = [row('2026-02-01', 200)]
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value.sourceKey).toBe('asset-b')
    await vi.advanceTimersByTimeAsync(0)
    pending[1]()
    await Promise.resolve()
    expect(model.snapshot.value).toMatchObject({ asOfDate: '2026-02-01', sourceKey: 'asset-b' })
    pending[0]()
    await Promise.resolve()
    expect(model.snapshot.value).toMatchObject({ asOfDate: '2026-02-01', sourceKey: 'asset-b' })
  })

  it('scope 释放会取消排队查询，并阻止在途结果回写', async () => {
    const query = vi.fn(({ rows }) => result(rows))
    setup(query)
    scope.stop()
    await vi.runAllTimersAsync()
    expect(query).not.toHaveBeenCalled()

    scope = effectScope()
    let resolve
    const model = setup(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await vi.advanceTimersByTimeAsync(0)
    scope.stop()
    resolve({ status: 'ready' })
    await Promise.resolve()
    expect(model.snapshot.value).toBeNull()
  })

  it('查询异常只写当前请求的失败状态', async () => {
    const model = setup(() => {
      throw new Error('invalid solver input')
    })
    await vi.runAllTimersAsync()
    expect(model.snapshot.value).toBeNull()
    expect(model.queryState.value).toMatchObject({ status: 'error', sourceKey: 'asset-a' })
  })
})
