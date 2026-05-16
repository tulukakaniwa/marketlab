import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDataLoader } from '../useDataLoader.js'

describe('useDataLoader', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('loads bundled market CSV data before falling back to fetch', async () => {
    const fetchMock = vi.fn(() => {
      throw new Error('fetch should not be used for bundled samples')
    })
    vi.stubGlobal('fetch', fetchMock)

    const loader = useDataLoader({})
    await loader.loadSample({
      id: 'btc',
      label: 'BTCUSDT 日线',
      symbol: 'BTCUSDT',
      url: '/data/btcusdt-1d-2017-2025.csv',
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(loader.error.value).toBe(null)
    expect(loader.rows.value.length).toBeGreaterThan(3000)
    expect(loader.rows.value[0].date).toBe('2017-08-17')
  })
})
