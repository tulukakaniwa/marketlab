import { describe, expect, it, beforeEach } from 'vitest'
import { useChartOverlays } from '../useChartOverlays.js'

describe('useChartOverlays', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem('lab.chartOverlays.v1')
    }
  })

  it('返回 10 个开关字段，默认值符合 spec', () => {
    const o = useChartOverlays()
    expect(o.costBand).toBe(true)
    expect(o.entryLine).toBe(true)
    expect(o.volBand).toBe(true)
    expect(o.volume).toBe(true)
    expect(o.replayMarkers).toBe(true)
    expect(o.currentDecision).toBe(true)
    expect(o.deltaPane).toBe(false)
    expect(o.equityPane).toBe(false)
    expect(o.kdjPane).toBe(true)
    expect(o.rsiPane).toBe(true)
  })

  it('单字段修改是 reactive，下次取重新返回', () => {
    const o = useChartOverlays()
    o.deltaPane = true
    expect(o.deltaPane).toBe(true)
  })

  it('字段级合并：旧 storage 缺新字段时回退到默认值', () => {
    if (typeof window === 'undefined') return
    // 写入只含部分字段的旧数据
    window.localStorage.setItem(
      'lab.chartOverlays.v1',
      JSON.stringify({ costBand: false, deltaPane: true })
    )
    const o = useChartOverlays()
    expect(o.costBand).toBe(false)        // 旧值保留
    expect(o.deltaPane).toBe(true)         // 旧值保留
    expect(o.entryLine).toBe(true)         // 缺字段回退默认
    expect(o.volume).toBe(true)            // 缺字段回退默认
  })
})
