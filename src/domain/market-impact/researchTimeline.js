import { completedBarTime, instant } from './impactChartTime.js'

export const MAX_RESEARCH_SNAPSHOTS = 288
export const DEFAULT_SNAPSHOT_AGE_MS = 15 * 60 * 1000

const boundedLimit = (value, maximum) => (Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : maximum)
const issue = (reason, value) => ({ reason, ...value })

/** Append-only captured evidence. receivedAt is the persisted first successful
 * local verification time, never a browser load time or an inferred clock. */
export function appendResearchSnapshots(existing, incoming, { receivedAt, limit = MAX_RESEARCH_SNAPSHOTS } = {}) {
  const snapshots = []
  const issues = []
  const ids = new Map()
  const retained = Array.isArray(existing) ? existing : []
  const entries = [...retained, ...(Array.isArray(incoming) ? incoming : [])]
  for (const [index, entry] of entries.entries()) {
    const originalMs = instant(entry?.availableAt)
    const receivedMs = instant(entry?.receivedAt ?? receivedAt)
    const id = entry?.id
    if (
      typeof id !== 'string' ||
      !id.trim() ||
      id.length > 256 ||
      originalMs === null ||
      receivedMs === null ||
      !entry.report ||
      typeof entry.report !== 'object'
    ) {
      issues.push(issue('invalid-research-snapshot', { id: typeof id === 'string' ? id : null }))
      continue
    }
    const known = ids.get(id)
    if (known) {
      if (
        known.availableAt !== new Date(originalMs).toISOString() ||
        JSON.stringify(known.report) !== JSON.stringify(entry.report)
      )
        issues.push(issue('snapshot-revision-ignored', { id }))
      continue
    }
    const effectiveMs = Math.max(originalMs, receivedMs)
    const last = snapshots.at(-1)
    if (last) {
      const sourceTime = instant(last.availableAt)
      const ingressTime = instant(last.receivedAt)
      const effectiveTime = instant(last.effectiveAvailableAt)
      const reason =
        originalMs === sourceTime || effectiveMs === effectiveTime
          ? 'conflicting-snapshot-time'
          : originalMs < sourceTime || receivedMs < ingressTime || effectiveMs < effectiveTime
            ? 'backdated-snapshot-ignored'
            : null
      if (reason) {
        issues.push(issue(reason, { id }))
        continue
      }
    }
    const snapshot = {
      id,
      availableAt: new Date(originalMs).toISOString(),
      receivedAt: new Date(receivedMs).toISOString(),
      effectiveAvailableAt: new Date(effectiveMs).toISOString(),
      report: index < retained.length ? entry.report : structuredClone(entry.report),
    }
    snapshots.push(snapshot)
    ids.set(id, snapshot)
  }
  const keep = boundedLimit(limit, MAX_RESEARCH_SNAPSHOTS)
  if (snapshots.length > keep) issues.push(issue('snapshot-retention-limit', { discarded: snapshots.length - keep }))
  return { snapshots: snapshots.slice(-keep), issues }
}

const candleFields = ['open', 'high', 'low', 'close', 'volume', 'closeTime', 'completedAt', 'availableAt']

function validClosedRow(row) {
  if (row?.isClosed !== true && row?.closed !== true) return false
  if (row?.isClosed === false || row?.closed === false || instant(row?.date) === null) return false
  if (!['open', 'high', 'low', 'close'].every((key) => Number.isFinite(row[key]) && row[key] > 0)) return false
  if (!Number.isFinite(row.volume) || row.volume < 0) return false
  if (row.low > Math.min(row.open, row.close) || row.high < Math.max(row.open, row.close)) return false
  return completedBarTime(row, { timeframe: 'intraday' }).reason === null
}

/** Merge already-validated, closed exchange candles without rewriting a
 * previously observed OHLCV. An initial history is a backfill, not a vintage
 * audit. Missing/late intervals remain absent rather than being fabricated. */
export function mergeResearchMarketRows(existing, incoming, { limit = 1000 } = {}) {
  const rows = []
  const issues = []
  const dates = new Map()
  for (const row of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])]) {
    if (!validClosedRow(row)) {
      issues.push(issue('invalid-or-unclosed-market-row', { date: row?.date ?? null }))
      continue
    }
    const known = dates.get(row.date)
    if (known) {
      if (candleFields.some((key) => known[key] !== row[key]))
        issues.push(issue('market-revision-ignored', { date: row.date }))
      continue
    }
    const completion = completedBarTime(row, { timeframe: 'intraday' }).time
    const last = rows.at(-1)
    if (last && instant(row.date) < completedBarTime(last, { timeframe: 'intraday' }).time) {
      issues.push(issue('late-or-overlapping-market-row-ignored', { date: row.date }))
      continue
    }
    if (last) {
      const previousEnd = completedBarTime(last, { timeframe: 'intraday' }).time
      if (instant(row.date) > previousEnd + 1)
        issues.push(issue('missing-market-intervals', { after: last.date, before: row.date }))
    }
    if (completion <= instant(row.date)) continue
    const saved = { ...row, historicalRevisionAudit: row.historicalRevisionAudit ?? 'not-performed' }
    rows.push(saved)
    dates.set(row.date, saved)
  }
  const keep = boundedLimit(limit, 1000)
  if (rows.length > keep) issues.push(issue('market-retention-limit', { discarded: rows.length - keep }))
  return { rows: rows.slice(-keep), issues }
}
