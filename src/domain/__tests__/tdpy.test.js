import { describe, expect, it } from 'vitest'
import { inferTdpy } from '../market/tdpy.js'

describe('inferTdpy', () => {
  it('detects crypto by market or symbol token', () => {
    expect(inferTdpy({ symbol: 'BTCUSDT', market: '加密' })).toEqual({
      value: 365,
      basis: 'crypto',
      label: '加密 365',
    })
    expect(inferTdpy({ symbol: 'ETHUSDT' }).basis).toBe('crypto')
  })

  it('detects US equities', () => {
    expect(inferTdpy({ symbol: 'AAPL', market: '美股' })).toEqual({
      value: 252,
      basis: 'us',
      label: '美股 252',
    })
  })

  it('detects Hong Kong equities before alphabetic fallback', () => {
    expect(inferTdpy({ symbol: '0700.HK', market: '港股' }).value).toBe(242)
    expect(inferTdpy({ symbol: '9988.HK' }).basis).toBe('hk')
  })

  it('detects China A shares', () => {
    expect(inferTdpy({ symbol: '600519', market: 'A股' }).value).toBe(242)
    expect(inferTdpy({ symbol: '300750' }).basis).toBe('cn')
  })

  it('falls back safely for unknown input', () => {
    expect(inferTdpy(null)).toEqual({ value: 365, basis: 'fallback', label: '默认 365' })
    expect(inferTdpy({}).basis).toBe('fallback')
    expect(inferTdpy({ symbol: '???' }).basis).toBe('fallback')
  })
})
