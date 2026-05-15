import { describe, expect, it } from 'vitest'
import { inferTdpy } from '../market/tdpy.js'

describe('inferTdpy', () => {
  it('加密：market === "加密" → 365 / crypto', () => {
    const meta = inferTdpy({ symbol: 'BTCUSDT', market: '加密' })
    expect(meta).toEqual({ value: 365, basis: 'crypto', label: '加密 365' })
  })

  it('加密：symbol 含 BTC 也走 365 / crypto（兜底）', () => {
    expect(inferTdpy({ symbol: 'BTCUSDT' }).basis).toBe('crypto')
    expect(inferTdpy({ symbol: 'ETHUSDT' }).basis).toBe('crypto')
  })

  it('美股：AAPL → 252 / us', () => {
    const meta = inferTdpy({ symbol: 'AAPL', market: '美股' })
    expect(meta).toEqual({ value: 252, basis: 'us', label: '美股 252' })
  })

  it('港股：0700.HK → 242 / hk', () => {
    expect(inferTdpy({ symbol: '0700.HK', market: '港股' }).value).toBe(242)
    expect(inferTdpy({ symbol: '9988.HK' }).basis).toBe('hk')
  })

  it('A 股：6 位数字 symbol → 242 / cn', () => {
    expect(inferTdpy({ symbol: '600519', market: 'A股' }).value).toBe(242)
    expect(inferTdpy({ symbol: '300750' }).basis).toBe('cn')
  })

  it('未知：null / 异常输入 → 365 / fallback', () => {
    expect(inferTdpy(null)).toEqual({ value: 365, basis: 'fallback', label: '默认 365' })
    expect(inferTdpy({}).basis).toBe('fallback')
    expect(inferTdpy({ symbol: '???' }).basis).toBe('fallback')
  })
})
