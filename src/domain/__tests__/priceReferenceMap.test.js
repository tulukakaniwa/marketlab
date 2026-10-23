import { describe, expect, it } from 'vitest'
import {
  buildPriceReferenceMap,
  iteratePriceReferenceMap,
  PRICE_REFERENCE_MAP_LIMITS,
} from '../research-visualization/priceReferenceMap.js'
import { buildVolumePriceProfile } from '../research-visualization/volumePriceProfile.js'

function sampleRows(length = 100) {
  return Array.from({ length }, (_, index) => {
    const close = 100 + Math.sin(index / 3) * 10 + index / 20
    return {
      date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100 + (index % 7) * 40,
    }
  })
}

describe('causal rolling price reference map', () => {
  it('retains the full path, warms eight sessions and uses only the last sixty sessions at each point', () => {
    const rows = sampleRows(130)
    const map = buildPriceReferenceMap({ rows })
    expect(map).toMatchObject({
      status: 'ready',
      asOfDate: rows.at(-1).date,
      lookbackSessions: 60,
      binCount: 36,
      observationIndex: 129,
      visibleRows: 130,
      source: 'ohlcv-volume-proxy',
      futureRowsUsed: false,
      executionAuthority: 'none',
    })
    expect(map.path).toHaveLength(130)
    expect(map.path.slice(0, 7).every((point) => point.status === 'warming-up' && point.nodes.length === 0)).toBe(true)
    expect(map.path[7]).toMatchObject({ status: 'ready', sampleSize: 8, availableAt: `${rows[7].date}:close` })
    expect(map.path[59]).toMatchObject({ sampleSize: 60, windowStart: rows[0].date })
    expect(map.path[60]).toMatchObject({ sampleSize: 60, windowStart: rows[1].date })
    expect(map.path.at(-1).windowStart).toBe(rows[70].date)
  })

  it('never revises earlier nodes or intensity when extreme future prices and volumes are appended', () => {
    const rows = sampleRows()
    const prefix = buildPriceReferenceMap({ rows: rows.slice(0, 50) })
    const future = rows.map((row, index) =>
      index < 50
        ? row
        : {
            ...row,
            open: row.open * 1000,
            high: row.high * 1000,
            low: row.low * 1000,
            close: row.close * 1000,
            volume: 1e12,
          },
    )
    expect(buildPriceReferenceMap({ rows: future }).path.slice(0, 50)).toEqual(prefix.path)
    expect(buildPriceReferenceMap({ rows, observationIndex: 49 })).toEqual(prefix)
  })

  it('does not read rows after an explicit observation index, including future getters', () => {
    const rows = sampleRows(20)
    Object.defineProperty(rows, 12, {
      get() {
        throw new Error('future row was read')
      },
    })
    expect(buildPriceReferenceMap({ rows, observationIndex: 11 }).path).toHaveLength(12)
    for (const observationIndex of [-1, 1.5, NaN, Infinity, 20, '5']) {
      expect(buildPriceReferenceMap({ rows, observationIndex })).toMatchObject({
        status: 'invalid-data',
        reason: 'invalid-observation-index',
        path: [],
      })
    }
  })

  it('reuses existing profile bins, normalizes within each window and keeps separated nodes with POC first', () => {
    const rows = sampleRows()
    const map = buildPriceReferenceMap({ rows })
    for (const index of [7, 25, 59, 70, 99]) {
      const point = map.path[index]
      const profile = buildVolumePriceProfile({ rows: rows.slice(Math.max(0, index - 59), index + 1), binCount: 36 })
      expect(point.nodes.length).toBeGreaterThan(0)
      expect(point.nodes.length).toBeLessThanOrEqual(3)
      expect(point.nodes[0]).toMatchObject({ price: profile.poc.mid, intensity: 1, isPoc: true })
      for (const [nodeIndex, node] of point.nodes.entries()) {
        const bin = profile.bins[node.binIndex]
        expect(node.share).toBe(bin.volume / profile.totalVolume)
        expect(node.intensity).toBe(bin.volume / profile.poc.volume)
        expect(node.side).toBe(
          point.close >= bin.lower && point.close <= bin.upper ? 'at' : bin.mid > point.close ? 'above' : 'below',
        )
        for (const other of point.nodes.slice(nodeIndex + 1)) {
          expect(Math.abs(node.binIndex - other.binIndex)).toBeGreaterThanOrEqual(
            PRICE_REFERENCE_MAP_LIMITS.minimumBinDistance,
          )
        }
      }
    }
  })

  it.each([
    [{ close: NaN }, 'invalid-ohlc-price'],
    [{ high: 1 }, 'inconsistent-ohlc-range'],
    [{ low: -1 }, 'invalid-ohlc-price'],
    [{ volume: -1 }, 'invalid-volume'],
    [{ volume: undefined }, 'invalid-volume'],
    [{ volume: Infinity }, 'invalid-volume'],
    [{ isClosed: false }, 'unclosed-session'],
    [{ closed: false }, 'unclosed-session'],
    [{ date: '2025-02-30' }, 'invalid-session-date'],
    [{ date: '2025-01-10' }, 'non-increasing-session-date'],
  ])('breaks the rolling segment for invalid or unclosed input %o', (patch, reason) => {
    const rows = sampleRows(25)
    rows[10] = { ...rows[10], ...patch }
    const { path } = buildPriceReferenceMap({ rows })
    expect(path[10]).toMatchObject({ status: 'invalid-data', reason, nodes: [], sampleSize: 0, availableAt: null })
    expect(path[11]).toMatchObject({ status: 'warming-up', sampleSize: 1, windowStart: rows[11].date, nodes: [] })
    expect(path[17].nodes).toEqual([])
    expect(path[18]).toMatchObject({ status: 'ready', sampleSize: 8, windowStart: rows[11].date })
  })

  it('preserves sparse gaps rather than joining history across them', () => {
    const rows = sampleRows(20)
    delete rows[10]
    const { path } = buildPriceReferenceMap({ rows })
    expect(path).toHaveLength(20)
    expect(path[10]).toMatchObject({ status: 'invalid-data', reason: 'invalid-session-date', nodes: [] })
    expect(path[11].sampleSize).toBe(1)
  })

  it.each(['volume-overflow', 'price-overflow'])(
    'breaks the segment rather than exposing numerically invalid nodes: %s',
    (kind) => {
      const rows = sampleRows(16)
      for (let index = 0; index < 8; index += 1) {
        rows[index] =
          kind === 'volume-overflow'
            ? { ...rows[index], volume: Number.MAX_VALUE }
            : { ...rows[index], open: 1.6e308, close: 1.6e308, high: 1.7e308, low: 1.5e308 }
      }
      const { path } = buildPriceReferenceMap({ rows })
      expect(path[7]).toMatchObject({
        status: 'invalid-data',
        reason: 'numerical-profile-failure',
        nodes: [],
        availableAt: null,
      })
      expect(path[8]).toMatchObject({ status: 'warming-up', sampleSize: 1, windowStart: rows[8].date })
      expect(path[15]).toMatchObject({ status: 'ready', sampleSize: 8, windowStart: rows[8].date })
      expect(path[15].nodes.every((node) => [node.price, node.share, node.intensity].every(Number.isFinite))).toBe(true)
    },
  )

  it('zero-volume sessions create no volume or nodes but count toward the rolling session window', () => {
    const rows = sampleRows(70).map((row) => ({ ...row, volume: 0 }))
    expect(buildPriceReferenceMap({ rows }).path.at(-1)).toMatchObject({
      status: 'no-volume',
      nodes: [],
      sampleSize: 60,
    })
    rows[0].volume = 100
    const { path } = buildPriceReferenceMap({ rows })
    expect(path[59].status).toBe('ready')
    expect(path[60]).toMatchObject({ status: 'no-volume', nodes: [], sampleSize: 60 })
  })

  it('the resumable pure iterator equals the synchronous query without mutating source or prior points', () => {
    const rows = Object.freeze(sampleRows(70).map(Object.freeze))
    const iterator = iteratePriceReferenceMap({ rows })
    const path = []
    let step
    do {
      step = iterator.next()
      if (!step.done) path.push(step.value)
    } while (!step.done)
    expect(step.value).toEqual(buildPriceReferenceMap({ rows }))
    expect(path).toEqual(step.value.path)
    path[7].nodes[0].price = -1
    expect(buildPriceReferenceMap({ rows }).path[7].nodes[0].price).toBeGreaterThan(0)
    expect(path[8].nodes[0].price).toBeGreaterThan(0)
  })

  it('handles absent history without a fabricated reference', () => {
    expect(buildPriceReferenceMap()).toMatchObject({ status: 'empty', path: [], asOfDate: null })
    expect(buildPriceReferenceMap({ rows: [] })).toMatchObject({ status: 'empty', path: [], asOfDate: null })
  })

  it('produces causal density nodes for positive low-price instruments without a currency floor', () => {
    const rows = sampleRows(8).map((item) => ({
      ...item,
      open: 1e-6,
      high: 1.1e-6,
      low: 0.9e-6,
      close: 1e-6,
      volume: 1000,
    }))
    const map = buildPriceReferenceMap({ rows })
    expect(map.status).toBe('ready')
    expect(map.path[7].nodes.length).toBeGreaterThan(0)
    for (const node of map.path[7].nodes) {
      expect(node.price).toBeGreaterThan(0.9e-6)
      expect(node.price).toBeLessThan(1.1e-6)
      expect(node.share).toBeGreaterThan(0)
      expect(node.intensity).toBeGreaterThan(0)
    }
  })

  it('handles the smallest representable positive price without a degenerate profile range', () => {
    const price = Number.MIN_VALUE
    const rows = sampleRows(8).map((item) => ({
      ...item,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 1000,
    }))
    const point = buildPriceReferenceMap({ rows }).path.at(-1)
    expect(point.status).toBe('ready')
    expect(point.nodes).toHaveLength(1)
    expect(point.nodes[0]).toMatchObject({ share: 1, intensity: 1, isPoc: true, side: 'at' })
    expect(point.nodes[0].price).toBeGreaterThan(0)
  })
})
