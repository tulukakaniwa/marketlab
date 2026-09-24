import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLabStore } from '../labStore.js'

const dateAt = (index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
function csv(base = 100) {
  return [
    'date,open,high,low,close,volume',
    ...Array.from({ length: 100 }, (_, index) => {
      const close = base + Math.sin(index / 5) * 3 + index * 0.03
      return `${dateAt(index)},${close},${close + 1},${close - 1},${close},1000`
    }),
  ].join('\n')
}

describe('lab causal query integration', () => {
  let pinia
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    pinia = createPinia()
    setActivePinia(pinia)
  })
  afterEach(() => {
    disposePinia(pinia)
    vi.useRealTimers()
  })
  async function settle() {
    await nextTick()
    await vi.runAllTimersAsync()
  }

  it('只查询观察日前缀，未来行和手填情景输入均不改变估计', async () => {
    const lab = useLabStore()
    lab.importText(csv(), 'causal-a')
    lab.setTdpyOverride('causal-a', 252)
    lab.setObservationDate(dateAt(50))
    await settle()
    const snapshot = lab.graph.causalModel
    expect(lab.causalPath).toBe(snapshot.chartPath)
    expect(lab.causalPath.at(-1).date).toBe(dateAt(50))
    expect(snapshot).toMatchObject({
      status: 'ready',
      asOfDate: dateAt(50),
      visibleRows: 51,
      futureRowsUsed: false,
      executionAuthority: 'none',
    })
    lab.rows[90].close = 100000
    lab.input.iv = 3
    lab.input.entryPrice = 10
    lab.input.strikePrice = 999
    lab.input.holdingDays = 999
    lab.input.targetReturn = 0.9
    await settle()
    expect(lab.graph.causalModel).toBe(snapshot)
    expect(lab.graph.causalModel.asOfDate).toBe(dateAt(50))
    lab.setObservationDate(dateAt(30))
    expect(lab.graph.causalModel).toBeNull()
    expect(lab.causalPath).toEqual([])
    expect(lab.graph.causalModelQuery.asOfDate).toBe(dateAt(30))
    await settle()
    expect(lab.graph.causalModel).toMatchObject({ asOfDate: dateAt(30), visibleRows: 31 })
  })

  it('更换样本立即清空上一个品种；缺年会话数时不得展示旧估计', async () => {
    const lab = useLabStore()
    lab.importText(csv(), 'causal-a')
    lab.setTdpyOverride('causal-a', 252)
    await settle()
    expect(lab.graph.causalModel.sourceKey).toBe('causal-a')
    lab.importText(csv(200), 'causal-b')
    expect(lab.graph.causalModel).toBeNull()
    expect(lab.causalPath).toEqual([])
    await settle()
    expect(lab.graph.causalModel).toBeNull()
    expect(lab.causalPath).toEqual([])
    expect(lab.graph.causalModelQuery).toMatchObject({ sourceKey: 'causal-b', status: 'idle', reason: 'missing-tdpy' })
    lab.setTdpyOverride('causal-b', 252)
    await settle()
    expect(lab.graph.causalModel.sourceKey).toBe('causal-b')
    expect(lab.graph.causalModel.state.markPrice).toBeGreaterThan(190)
  })
})
