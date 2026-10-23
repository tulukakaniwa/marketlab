import { describe, expect, it } from 'vitest'
import { buildVolumePriceProfile } from '../research-visualization/volumePriceProfile.js'

function row(date, open, high, low, close, volume) {
  return { date, open, high, low, close, volume }
}

describe('buildVolumePriceProfile', () => {
  it('按价格区间分摊 OHLCV 成交量，不依赖公式路径', () => {
    const rows = [
      row('2024-01-01', 10, 12, 10, 11, 100),
      row('2024-01-02', 11, 13, 11, 12, 200),
      row('2024-01-03', 12, 13, 12, 12.5, 300),
    ]
    const profile = buildVolumePriceProfile({ rows, binCount: 12 })

    expect(profile.status).toBe('proxy-only')
    expect(profile.method).toBe('volume-by-price')
    expect(profile.rows).toBe(3)
    expect(profile.bins).toHaveLength(12)
    expect(profile.totalVolume).toBeCloseTo(600, 8)
    expect(profile.poc.volume).toBeGreaterThan(0)
    expect(profile.valueArea.share).toBeGreaterThanOrEqual(0.7)
    expect(profile.windowSpec).toMatchObject({ mode: 'visible-prefix', visiblePrefixRows: 3, futureRowsUsed: false })
  })

  it('activeIndex 与 visibleWindow 限制筹码窗口，避免使用观察日之后数据', () => {
    const rows = Array.from({ length: 8 }, (_, i) => row(`2024-01-0${i + 1}`, 10 + i, 11 + i, 9 + i, 10.5 + i, 100 + i))
    const profile = buildVolumePriceProfile({ rows, activeIndex: 4, visibleWindow: 3, binCount: 16 })

    expect(profile.rows).toBe(3)
    expect(profile.firstDate).toBe('2024-01-03')
    expect(profile.lastDate).toBe('2024-01-05')
    expect(profile.currentPrice).toBe(14.5)
    expect(profile.totalVolume).toBeCloseTo(100 + 2 + 100 + 3 + 100 + 4, 8)
    expect(profile.windowSpec).toMatchObject({ mode: 'viewport-explicit', requestedWindowSessions: 3 })
  })

  it('标记 POC、当前价所在 bin 和价值区间', () => {
    const rows = [
      row('2024-01-01', 100, 101, 99, 100.5, 50),
      row('2024-01-02', 100.5, 103, 101, 102.5, 500),
      row('2024-01-03', 102.5, 103, 102, 102.8, 450),
    ]
    const profile = buildVolumePriceProfile({ rows, binCount: 20 })

    expect(profile.bins.some((bin) => bin.isPoc)).toBe(true)
    expect(profile.bins.some((bin) => bin.isCurrent)).toBe(true)
    expect(profile.bins.some((bin) => bin.inValueArea)).toBe(true)
    expect(profile.poc.isPoc).toBe(true)
  })

  it('无有效成交量时返回空模型', () => {
    const profile = buildVolumePriceProfile({
      rows: [row('2024-01-01', 10, 11, 9, 10, 0)],
    })

    expect(profile.status).toBe('empty')
    expect(profile.bins).toEqual([])
  })

  it('保留低于 0.0001 的正价格范围和全部成交量', () => {
    const rows = Array.from({ length: 8 }, (_, index) => row(`2024-01-0${index + 1}`, 1e-6, 1.1e-6, 0.9e-6, 1e-6, 1000))
    const profile = buildVolumePriceProfile({ rows })
    expect(profile.status).toBe('proxy-only')
    expect(profile.totalVolume).toBeCloseTo(8000, 8)
    expect(profile.range.lower).toBeGreaterThan(0)
    expect(profile.range.lower).toBeLessThan(0.9e-6)
    expect(profile.range.upper).toBeGreaterThan(1.1e-6)
    expect(profile.poc.mid).toBeGreaterThan(0.9e-6)
    expect(profile.poc.mid).toBeLessThan(1.1e-6)
  })

  it('相同数据更换价格单位不改变成交量分布', () => {
    const rows = [row('2024-01-01', 90, 90, 90, 90, 100), row('2024-01-02', 110, 110, 110, 110, 500)]
    const regular = buildVolumePriceProfile({ rows })
    const lowPrice = buildVolumePriceProfile({
      rows: rows.map((item) => ({
        ...item,
        open: item.open * 1e-8,
        high: item.high * 1e-8,
        low: item.low * 1e-8,
        close: item.close * 1e-8,
      })),
    })
    expect(lowPrice.status).toBe('proxy-only')
    expect(lowPrice.totalVolume).toBe(regular.totalVolume)
    expect(lowPrice.bins.map((bin) => [bin.volume, bin.share, bin.intensity])).toEqual(
      regular.bins.map((bin) => [bin.volume, bin.share, bin.intensity]),
    )
    expect(lowPrice.range.lower / regular.range.lower).toBeCloseTo(1e-8, 14)
    expect(lowPrice.range.upper / regular.range.upper).toBeCloseTo(1e-8, 14)
  })

  it.each([12, 36, 80])('最小正浮点价的 %i 个 bins 不因范围或步长下溢而丢失成交量', (binCount) => {
    const price = Number.MIN_VALUE
    const profile = buildVolumePriceProfile({ rows: [row('2024-01-01', price, price, price, price, 1000)], binCount })
    expect(profile.status).toBe('proxy-only')
    expect(profile.range.lower).toBe(price)
    expect(profile.range.upper).toBeGreaterThan(profile.range.lower)
    expect(profile.bins).toHaveLength(binCount)
    expect(profile.bins.every((bin) => bin.upper > bin.lower && bin.mid > 0)).toBe(true)
    expect(profile.totalVolume).toBe(1000)
    expect(profile.poc.intensity).toBe(1)
    expect(profile.poc.share).toBe(1)
  })
})
