import { describe, expect, it } from 'vitest'
import { buildImpactChartOverlay } from './impactChartOverlay.js'
import { appendResearchSnapshots } from './researchTimeline.js'
import { analyzeEthLpBundle } from './ethLpResearch.js'
import { analyzeEthOptionsBundle } from './ethOptionsResearch.js'
import { makeReplayFixture } from './__tests__/fixtures.js'
import { makeOptionsFixture } from './__tests__/optionsFixtures.js'

const time = (minute) => new Date(Date.parse('2026-10-23T12:00:00.000Z') + minute * 60000).toISOString()
const bar = (end) => ({ date: time(end - 5), completedAt: time(end), close: 2000, isClosed: true })
const source = { symbol: 'ETHUSDT', timeframe: '5m' }
const options = (id, minute, values = [100, 50], received = minute) => {
  const report = analyzeEthOptionsBundle(makeOptionsFixture())
  report.summary.availableAt = time(minute)
  report.tradeRows.forEach((row, index) => {
    row.openInterestEth = values[index] ?? 0
  })
  return { id, availableAt: time(minute), receivedAt: time(received), report }
}
const query = (history, ends, extra = {}) =>
  buildImpactChartOverlay({ source, rows: ends.map(bar), optionsHistory: history, ...extra })

describe('causal live research chart snapshots', () => {
  it('selects the latest available snapshot at each closed bar without changing old prefixes', () => {
    const first = options('a', 1)
    const next = options('b', 6, [300, 200])
    const before = query([first], [0, 5])
    const after = query([first, next], [0, 5, 10])
    expect(after.path.slice(0, 2)).toEqual(before.path)
    expect(after.path[0].nodes).toEqual([])
    expect(after.path[1].nodes[0]).toMatchObject({ rawValue: 150, snapshotId: 'a', availableAt: time(1) })
    expect(after.path[2].nodes[0]).toMatchObject({ rawValue: 500, snapshotId: 'b', effectiveAvailableAt: time(6) })
    expect(after.path[2].nodes).toHaveLength(1)
  })

  it('uses first verified receipt as the visibility bound and rejects backdated late records', () => {
    const accepted = appendResearchSnapshots([], [options('a', 1, [100, 50], 7)]).snapshots
    const before = query(accepted, [0, 5, 10])
    expect(before.path[1].nodes).toEqual([])
    expect(before.path[2].nodes[0]).toMatchObject({
      availableAt: time(1),
      receivedAt: time(7),
      effectiveAvailableAt: time(7),
    })
    const late = appendResearchSnapshots(accepted, [options('late', 2, [1, 1], 3)])
    expect(late.issues[0].reason).toBe('backdated-snapshot-ignored')
    expect(query(late.snapshots, [0, 5, 10]).path).toEqual(before.path)
  })

  it('expires old samples by original capture time, including samples received late', () => {
    const result = query([options('a', 0)], [15, 20])
    expect(result.path[0].nodes).toHaveLength(1)
    expect(result.path[1]).toMatchObject({
      nodes: [],
      sourceStatus: { options: { status: 'stale', reason: 'snapshot-expired' } },
    })
    expect(query([options('late', 0, [100, 50], 20)], [20]).path[0].sourceStatus.options.reason).toBe(
      'snapshot-expired',
    )
    expect(query([options('a', 0)], [10], { maxSnapshotAgeMs: 5 * 60000 }).path[0].nodes).toEqual([])
  })

  it('replaces earlier option OI with zero or an empty new snapshot without fallback', () => {
    const empty = options('empty', 11)
    empty.report.tradeRows = []
    const result = query([options('a', 1), options('zero', 6, [0, 0]), empty], [5, 10, 15])
    expect(result.path[0].nodes).toHaveLength(1)
    expect(result.path[1].nodes).toEqual([])
    expect(result.path[2].nodes).toEqual([])
    expect(result.path[1].sourceStatus.options.snapshotId).toBe('zero')
    expect(result.path[2].sourceStatus.options.snapshotId).toBe('empty')
  })

  it('replaces each LP window rather than cumulatively double counting repeated events across captures', () => {
    const report = analyzeEthLpBundle(makeReplayFixture())
    report.availableAt = time(1)
    const a = { id: 'a', availableAt: time(1), receivedAt: time(1), report }
    const b = { id: 'b', availableAt: time(6), receivedAt: time(6), report: { ...report, availableAt: time(6) } }
    const empty = {
      id: 'empty',
      availableAt: time(11),
      receivedAt: time(11),
      report: { ...report, availableAt: time(11), actions: [] },
    }
    const result = query([], [5, 10, 15], { lpHistory: [a, b, empty] })
    expect(result.path[0].nodes.map(({ rawValue }) => rawValue)).toEqual(
      result.path[1].nodes.map(({ rawValue }) => rawValue),
    )
    expect(result.path[1].nodes[0]).toMatchObject({ eventCount: 1, snapshotId: 'b' })
    expect(result.path[2].nodes).toEqual([])
  })

  it('rejects availability mismatches and same-time conflicts deterministically', () => {
    const conflicting = options('conflict', 1, [1000, 1000])
    const result = query([options('first', 1), conflicting], [5])
    expect(result.path[0].nodes[0].snapshotId).toBe('first')
    expect(result.historyIssues.options[0].reason).toBe('conflicting-snapshot-time')
    const mismatch = options('mismatch', 6)
    mismatch.report.summary.availableAt = time(8)
    expect(query([mismatch], [10]).path[0]).toMatchObject({
      nodes: [],
      sourceStatus: { options: { reason: 'snapshot-availability-mismatch' } },
    })
  })

  it('leaves every old prefix unchanged when a new snapshot changes future strikes and intensity', () => {
    const a = options('a', 1)
    const b = options('b', 6)
    const c = options('c', 11, [1000, 1])
    c.report.tradeRows[0].strikePriceUsd = 3000
    const ends = [0, 5, 10, 15, 20]
    const before = query([a, b], ends.slice(0, 3))
    expect(query([a, b, c], ends).path.slice(0, 3)).toEqual(before.path)
  })
})
