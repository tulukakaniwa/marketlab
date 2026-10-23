import { buildLpChartNodes, buildOptionsChartNodes } from './impactChartNodes.js'
import { chartIdentity, completedBarTime, instant } from './impactChartTime.js'
import { appendResearchSnapshots, DEFAULT_SNAPSHOT_AGE_MS } from './researchTimeline.js'

const META = Object.freeze({
  modelVersion: 'impact-chart-overlay-v1',
  executionAuthority: 'none',
  futureRowsUsed: false,
  claimClass: 'captured-research-observations',
  temporalBasis: 'snapshot-carried-forward-from-availability',
  intensityBasis: 'relative-within-source-snapshot-only',
  priceBasis: 'approximate-usd-reference-no-fx-conversion',
})

/**
 * Imported reports are capture-time evidence. Their old events are never
 * backdated onto event-time candles. Every point is gated by its completed bar
 * time, and retains the imported availability time when a snapshot is carried
 * forward. No scenario execution price, hedge quantity, or inferred GEX enters
 * this query. USD/USDC/USDT use an explicitly labelled dollar approximation
 * requested by the workbench; displayed prices are not converted FX quotes.
 */
export function buildImpactChartOverlay({
  lp,
  options,
  lpHistory,
  optionsHistory,
  source,
  rows,
  maxSnapshotAgeMs,
} = {}) {
  const identity = chartIdentity(source)
  const histories = { lp: lpHistory, options: optionsHistory }
  const sources = {
    lp: prepareSource('lp', lp, identity),
    options: prepareSource('options', options, identity),
  }
  const timelines = Object.fromEntries(
    Object.entries(histories)
      .filter(([, history]) => history !== undefined)
      .map(([kind, history]) => [kind, prepareTimeline(kind, history, identity)]),
  )
  const ttl = Number.isFinite(maxSnapshotAgeMs) && maxSnapshotAgeMs >= 0 ? maxSnapshotAgeMs : DEFAULT_SNAPSHOT_AGE_MS
  let previousDate = null
  let previousClose = null
  const path = (Array.isArray(rows) ? rows : []).map((row, index) => {
    const completion = completedBarTime(row, source)
    let reason = completion.reason
    if (typeof row?.date === 'string' && previousDate !== null && row.date <= previousDate)
      reason = 'non-increasing-session-date'
    if (completion.time !== null && previousClose !== null && completion.time <= previousClose)
      reason = 'non-increasing-completion-time'
    if (typeof row?.date === 'string' && (previousDate === null || row.date > previousDate)) previousDate = row.date
    if (completion.time !== null && (previousClose === null || completion.time > previousClose))
      previousClose = completion.time
    const pointSources = Object.fromEntries(
      Object.entries(sources).map(([kind, prepared]) => [
        kind,
        timelines[kind]
          ? timelineAt(timelines[kind], reason ? null : completion.time, ttl)
          : sourceAt(prepared, reason ? null : completion.time),
      ]),
    )
    const nodes = reason ? [] : Object.values(pointSources).flatMap((value) => value.nodes)
    const state = combinedState(pointSources, nodes)
    return {
      date: typeof row?.date === 'string' ? row.date : null,
      index,
      completedAt: completion.time === null ? null : new Date(completion.time).toISOString(),
      status: reason ? 'invalid-data' : state.status,
      reason: reason ?? state.reason,
      nodes,
      sourceStatus: withoutNodes(pointSources),
    }
  })
  const latest = path.at(-1)
  return {
    ...META,
    status: latest?.status ?? 'empty',
    reason: latest?.reason ?? 'missing-history',
    sourceStatus: latest?.sourceStatus ?? withoutNodes(sources),
    asset: identity.baseAsset,
    quoteCurrency: identity.quoteCurrency,
    quoteApproximation: Object.values(latest?.sourceStatus ?? sources).some((value) => value.quoteApproximation),
    asOfDate: latest?.date ?? null,
    completedAt: latest?.completedAt ?? null,
    ...(Object.keys(timelines).length
      ? {
          historyIssues: Object.fromEntries(Object.entries(timelines).map(([kind, value]) => [kind, value.issues])),
          maxSnapshotAgeMs: ttl,
        }
      : {}),
    path,
  }
}

function prepareTimeline(kind, history, identity) {
  const { snapshots, issues } = appendResearchSnapshots(history, [])
  return {
    fallback: prepareSource(kind, null, identity),
    issues,
    snapshots: snapshots.map((snapshot) => {
      const prepared = prepareSource(kind, snapshot.report, identity)
      const matches = instant(prepared.availableAt) === instant(snapshot.availableAt)
      return {
        ...prepared,
        ...(matches ? {} : { status: 'blocked', reason: 'snapshot-availability-mismatch', nodes: [] }),
        snapshotId: snapshot.id,
        receivedAt: snapshot.receivedAt,
        effectiveAvailableAt: snapshot.effectiveAvailableAt,
        effectiveAvailableMs: instant(snapshot.effectiveAvailableAt),
      }
    }),
  }
}

function timelineAt(timeline, completedMs, maxAgeMs) {
  // Before the first accepted snapshot, return the same empty state regardless
  // of snapshots learned later. Future metadata must not rewrite old points.
  if (completedMs === null) return timeline.fallback
  let selected = null
  for (const snapshot of timeline.snapshots) {
    if (snapshot.effectiveAvailableMs > completedMs) break
    selected = snapshot
  }
  if (!selected) return timeline.fallback
  const age = completedMs - instant(selected.availableAt)
  if (age > maxAgeMs) return { ...selected, status: 'stale', reason: 'snapshot-expired', nodes: [], snapshotAgeMs: age }
  return sourceAt(selected, completedMs)
}

function laneReport(lane) {
  if (!lane) return { reason: 'no-sample' }
  if ('phase' in lane) {
    if (lane.phase === 'idle') return { reason: 'no-sample' }
    if (lane.phase !== 'ready') return { reason: 'research-not-ready' }
    return { report: lane.report }
  }
  return { report: lane }
}

function prepareSource(kind, lane, identity) {
  const quoteCurrency = kind === 'lp' ? 'USDC' : 'USD'
  const base = {
    kind,
    label: kind === 'lp' ? 'LP 动作区间' : '期权持仓量',
    quoteCurrency,
    axisQuoteCurrency: identity.quoteCurrency,
    quoteApproximation: false,
    priceBasis: META.priceBasis,
    status: 'empty',
    reason: null,
    availableAt: null,
    dataOrigin: 'unknown',
    nodes: [],
    meaning: kind === 'lp' ? 'observed-liquidity-action-not-current-depth' : 'covered-contract-oi-not-net-gamma',
    temporalBasis: META.temporalBasis,
    intensityBasis: kind === 'lp' ? 'absolute-liquidity-change-raw' : 'unique-contract-open-interest-eth',
  }
  const unpacked = laneReport(lane)
  if (unpacked.reason) return { ...base, reason: unpacked.reason }
  const report = unpacked.report
  if (!report || !['verified', 'ready', 'partial'].includes(report.status))
    return { ...base, status: 'blocked', reason: 'research-not-ready' }
  base.dataOrigin = report.dataOrigin ?? 'unknown'
  base.availableAt = kind === 'lp' ? report.availableAt : report.summary?.availableAt
  if (identity.reason) return { ...base, status: 'incompatible', reason: identity.reason }
  if (!['USD', 'USDC', 'USDT'].includes(identity.quoteCurrency))
    return { ...base, status: 'incompatible', reason: 'quote-mismatch' }
  base.quoteApproximation = identity.quoteCurrency !== quoteCurrency
  const availableMs = instant(base.availableAt)
  if (availableMs === null) return { ...base, status: 'blocked', reason: 'missing-availability-time' }
  const result = kind === 'lp' ? buildLpChartNodes(report, availableMs) : buildOptionsChartNodes(report, availableMs)
  return {
    ...base,
    availableAt: new Date(availableMs).toISOString(),
    availableMs,
    ...result,
    status: result.reason ? 'blocked' : result.nodes.length ? 'ready' : 'empty',
    reason: result.reason ?? (result.nodes.length ? null : 'no-observations'),
  }
}

function sourceAt(prepared, completedMs) {
  if (prepared.status !== 'ready') return prepared
  if (completedMs === null) return { ...prepared, status: 'empty', reason: 'unknown-completion-time', nodes: [] }
  if (prepared.availableMs > completedMs)
    return { ...prepared, status: 'not-yet-available', reason: 'snapshot-after-observation', nodes: [] }
  const candidates = prepared.nodes.filter((node) => node.expiryMs === undefined || node.expiryMs > completedMs)
  const nodes = normalizeNodes(candidates, prepared)
  return {
    ...prepared,
    nodes,
    status: nodes.length ? 'ready' : 'empty',
    reason: nodes.length ? null : 'no-unexpired-observations',
    snapshotAgeMs: completedMs - prepared.availableMs,
    candidateCount: candidates.length,
    displayedCount: nodes.length,
  }
}

function normalizeNodes(candidates, source) {
  // OI is first deduplicated per contract, then aggregated by strike among
  // contracts still alive at this bar. Later expiry never rewrites older bars.
  let nodes = candidates
  if (source.kind === 'options') {
    const strikes = new Map()
    for (const node of candidates) {
      const group = strikes.get(node.price) ?? {
        ...node,
        id: `options:${node.price}`,
        rawValue: 0,
        tradeVolumeEth: 0,
        contractCount: 0,
      }
      group.rawValue += node.rawValue
      group.tradeVolumeEth += node.tradeVolumeEth
      group.contractCount += 1
      strikes.set(node.price, group)
    }
    nodes = [...strikes.values()].filter(
      (node) => Number.isFinite(node.rawValue) && Number.isFinite(node.tradeVolumeEth),
    )
  }
  const maximum = Math.max(0, ...nodes.map((node) => Number(node.rawValue)))
  if (!(maximum > 0) || !Number.isFinite(maximum)) return []
  return [...nodes]
    .filter((node) => Number(node.rawValue) > 0)
    .sort((left, right) => Number(right.rawValue) - Number(left.rawValue) || left.price - right.price)
    .slice(0, 12)
    .map((node) => ({
      ...node,
      kind: source.kind,
      sourceKind: source.kind,
      quoteCurrency: source.quoteCurrency,
      axisQuoteCurrency: source.axisQuoteCurrency,
      quoteApproximation: source.quoteApproximation,
      priceBasis: META.priceBasis,
      intensity: Number(node.rawValue) / maximum,
      availableAt: source.availableAt,
      ...(source.snapshotId
        ? {
            snapshotId: source.snapshotId,
            receivedAt: source.receivedAt,
            effectiveAvailableAt: source.effectiveAvailableAt,
          }
        : {}),
      dataOrigin: source.dataOrigin,
      temporalBasis: META.temporalBasis,
      intensityBasis: source.intensityBasis,
      executionAuthority: 'none',
    }))
}

function withoutNodes(sources) {
  return Object.fromEntries(Object.entries(sources).map(([kind, { nodes: _nodes, ...state }]) => [kind, state]))
}

function combinedState(sources, nodes) {
  if (nodes.length) return { status: 'ready', reason: null }
  const states = Object.values(sources)
  const future = states.find((state) => state.status === 'not-yet-available')
  const reason = future?.reason ?? states.find((state) => state.reason !== 'no-sample')?.reason ?? 'no-sample'
  return { status: future ? 'not-yet-available' : 'empty', reason }
}
