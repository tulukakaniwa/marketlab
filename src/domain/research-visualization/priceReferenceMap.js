import { buildVolumePriceProfile } from './volumePriceProfile.js'

export const PRICE_REFERENCE_MAP_LIMITS = Object.freeze({
  lookbackSessions: 60,
  binCount: 36,
  minimumSessions: 8,
  maximumNodes: 3,
  minimumBinDistance: 3,
})

const METADATA = Object.freeze({
  modelVersion: 'price-reference-map-v1',
  source: 'ohlcv-volume-proxy',
  method: 'rolling-volume-by-price',
  claimClass: 'volume-density-proxy',
  executionAuthority: 'none',
  futureRowsUsed: false,
  lookbackSessions: PRICE_REFERENCE_MAP_LIMITS.lookbackSessions,
  binCount: PRICE_REFERENCE_MAP_LIMITS.binCount,
})

/**
 * Each point rebuilds only its preceding closed-session window. Neither the
 * price bins nor intensity use later rows. OHLCV volume is distributed over a
 * candle's range by the existing profile model; it is not observed positions,
 * pending orders, option flow or gamma exposure. Historical points never move
 * when a later candle changes the current window's price range.
 *
 * Cost is O(n * 60 * 36), with no history truncation and a bounded local window.
 * Missing closure flags retain the completed daily CSV input contract.
 */
export function buildPriceReferenceMap({ rows, observationIndex = null } = {}) {
  const points = iteratePriceReferenceMap({ rows, observationIndex })
  let next = points.next()
  while (!next.done) next = points.next()
  return next.value
}

/** Pure forward iterator lets a ViewModel schedule batches without browser APIs here. */
export function* iteratePriceReferenceMap({ rows, observationIndex = null } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return emptyMap('empty', 'missing-history')
  const index = observationIndex === null ? rows.length - 1 : observationIndex
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    return emptyMap('invalid-data', 'invalid-observation-index')
  }
  let lastOrderedDate = null
  let windowRows = []
  const path = []
  for (let position = 0; position <= index; position += 1) {
    const row = rows[position]
    const reason = invalidReason(row, lastOrderedDate)
    if (validDate(row?.date) && (lastOrderedDate === null || row.date > lastOrderedDate)) lastOrderedDate = row.date
    if (reason) {
      windowRows = []
      const point = pointMetadata(row, position, 'invalid-data', { reason })
      path.push(point)
      yield point
      continue
    }
    windowRows.push(row)
    if (windowRows.length > PRICE_REFERENCE_MAP_LIMITS.lookbackSessions) windowRows.shift()
    let point = pointMetadata(row, position, 'warming-up', {
      sampleSize: windowRows.length,
      windowStart: windowRows[0].date,
      availableAt: `${row.date}:close`,
    })
    if (windowRows.length >= PRICE_REFERENCE_MAP_LIMITS.minimumSessions) {
      const profile = buildVolumePriceProfile({ rows: windowRows, binCount: PRICE_REFERENCE_MAP_LIMITS.binCount })
      if (!finiteProfile(profile)) {
        windowRows = []
        point = pointMetadata(row, position, 'invalid-data', { reason: 'numerical-profile-failure' })
      } else {
        point.nodes = selectNodes(profile, row.close)
        point.status = point.nodes.length ? 'ready' : 'no-volume'
      }
    }
    path.push(point)
    yield point
  }
  const latest = path.at(-1)
  return {
    ...METADATA,
    path,
    status: latest.status,
    reason: latest.reason ?? null,
    asOfDate: latest.date,
    availableAt: latest.availableAt,
    observationIndex: index,
    visibleRows: path.length,
  }
}

function finiteProfile(profile) {
  if (!Number.isFinite(profile.totalVolume) || profile.totalVolume < 0) return false
  if (profile.range && !Object.values(profile.range).every((value) => Number.isFinite(value) && value > 0)) return false
  if (profile.range && !(profile.range.upper > profile.range.lower)) return false
  return profile.bins.every(
    (bin) =>
      [bin.lower, bin.upper, bin.mid].every((value) => Number.isFinite(value) && value > 0) &&
      Number.isFinite(bin.volume) &&
      bin.volume >= 0 &&
      [bin.share, bin.intensity].every((value) => Number.isFinite(value) && value >= 0 && value <= 1),
  )
}

function selectNodes(profile, close) {
  // POC first, then strongest separated bins. This is a density selection rule,
  // not a buy/sell rule. A node's side is relative to this point's close only.
  const candidates = profile.bins
    .filter((bin) => Number.isFinite(bin.volume) && bin.volume > 0)
    .sort(
      (left, right) =>
        Number(right.isPoc) - Number(left.isPoc) || right.volume - left.volume || left.index - right.index,
    )
  const selected = []
  for (const bin of candidates) {
    if (selected.some((other) => Math.abs(other.index - bin.index) < PRICE_REFERENCE_MAP_LIMITS.minimumBinDistance))
      continue
    selected.push(bin)
    if (selected.length === PRICE_REFERENCE_MAP_LIMITS.maximumNodes) break
  }
  return selected.map((bin) => ({
    price: bin.mid,
    share: bin.share,
    intensity: bin.intensity,
    isPoc: bin.isPoc,
    binIndex: bin.index,
    side: close >= bin.lower && close <= bin.upper ? 'at' : bin.mid > close ? 'above' : 'below',
  }))
}

function pointMetadata(row, index, status, extra = {}) {
  return {
    ...METADATA,
    date: typeof row?.date === 'string' ? row.date : null,
    index,
    status,
    close: Number.isFinite(row?.close) && row.close > 0 ? row.close : null,
    nodes: [],
    sampleSize: 0,
    windowStart: null,
    availableAt: null,
    ...extra,
  }
}

function invalidReason(row, lastOrderedDate) {
  if (!validDate(row?.date)) return 'invalid-session-date'
  if (lastOrderedDate !== null && row.date <= lastOrderedDate) return 'non-increasing-session-date'
  if (row.isClosed === false || row.closed === false) return 'unclosed-session'
  if (['open', 'high', 'low', 'close'].some((key) => !Number.isFinite(row[key]) || row[key] <= 0))
    return 'invalid-ohlc-price'
  if (row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close) || row.high < row.low) {
    return 'inconsistent-ohlc-range'
  }
  if (!Number.isFinite(row.volume) || row.volume < 0) return 'invalid-volume'
  return null
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const timestamp = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
}

function emptyMap(status, reason) {
  return {
    ...METADATA,
    status,
    reason,
    path: [],
    asOfDate: null,
    availableAt: null,
    observationIndex: null,
    visibleRows: 0,
  }
}
