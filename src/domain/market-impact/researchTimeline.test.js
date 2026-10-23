import { describe, expect, it } from 'vitest'
import { appendResearchSnapshots, mergeResearchMarketRows } from './researchTimeline.js'

const time = (minute) => new Date(Date.parse('2026-10-23T12:00:00.000Z') + minute * 60000).toISOString()
const entry = (id, minute, received = minute + 1, value = 10) => ({
  id,
  availableAt: time(minute),
  receivedAt: time(received),
  report: { value },
})
const row = (minute) => ({
  date: time(minute),
  completedAt: time(minute + 5),
  open: 100,
  high: 102,
  low: 99,
  close: 101,
  volume: 50,
  isClosed: true,
})
const reasons = (result) => result.issues.map(({ reason }) => reason)

describe('append-only research snapshot history', () => {
  it('freezes the first report and reception time when a snapshot is reread or revised', () => {
    const input = entry('a', 0)
    const first = appendResearchSnapshots([], [input])
    input.report.value = 999
    const reread = appendResearchSnapshots(first.snapshots, [entry('a', 0, 4), entry('a', 0, 5, 999)])
    expect(reread.snapshots).toEqual(first.snapshots)
    expect(reread.snapshots[0]).toMatchObject({
      receivedAt: time(1),
      effectiveAvailableAt: time(1),
      report: { value: 10 },
    })
    expect(reasons(reread)).toEqual(['snapshot-revision-ignored'])
  })

  it('requires an explicit persisted reception time and uses the later availability bound', () => {
    expect(appendResearchSnapshots([], [{ id: 'a', availableAt: time(0), report: {} }]).snapshots).toEqual([])
    expect(
      appendResearchSnapshots([], [{ id: 'a', availableAt: time(0), report: {} }], { receivedAt: time(2) }).snapshots[0]
        .effectiveAvailableAt,
    ).toBe(time(2))
    expect(appendResearchSnapshots([], [entry('b', 3, 2)]).snapshots[0].effectiveAvailableAt).toBe(time(3))
  })

  it('rejects conflicting timestamps, older source captures and backdated reception', () => {
    const original = appendResearchSnapshots([], [entry('a', 5, 10)]).snapshots
    const result = appendResearchSnapshots(original, [
      entry('same-capture', 5, 11),
      entry('same-effective', 6, 10),
      entry('old-capture', 4, 11),
      entry('old-reception', 12, 9),
      entry('new', 12, 13),
    ])
    expect(result.snapshots.map(({ id }) => id)).toEqual(['a', 'new'])
    expect(reasons(result)).toEqual([
      'conflicting-snapshot-time',
      'conflicting-snapshot-time',
      'backdated-snapshot-ignored',
      'backdated-snapshot-ignored',
    ])
    expect(result.snapshots[0]).toEqual(original[0])
  })

  it('retains at most 288 snapshots without sorting an out-of-order arrival into the past', () => {
    const result = appendResearchSnapshots(
      [],
      Array.from({ length: 300 }, (_, index) => entry(String(index), index * 2)),
      { limit: 9999 },
    )
    expect(result.snapshots).toHaveLength(288)
    expect(result.snapshots[0].id).toBe('12')
    expect(reasons(result)).toContain('snapshot-retention-limit')
    const unsorted = appendResearchSnapshots([], [entry('new', 10), entry('old', 0)])
    expect(unsorted.snapshots.map(({ id }) => id)).toEqual(['new'])
    expect(reasons(unsorted)).toContain('backdated-snapshot-ignored')
  })
})

describe('first-seen closed market candles', () => {
  it('appends new rows while retaining initial history and reporting later OHLCV revisions', () => {
    const initial = mergeResearchMarketRows([], [row(0), row(5)])
    const next = mergeResearchMarketRows(initial.rows, [{ ...row(0), close: 102 }, row(5), row(10)])
    expect(next.rows.slice(0, 2)).toEqual(initial.rows)
    expect(next.rows).toHaveLength(3)
    expect(reasons(next)).toEqual(['market-revision-ignored'])
    expect(next.rows.every((item) => item.historicalRevisionAudit === 'not-performed')).toBe(true)
  })

  it('rejects unfinished, malformed and overlapping rows without filling late gaps', () => {
    const first = mergeResearchMarketRows([], [row(0), row(10)])
    expect(reasons(first)).toEqual(['missing-market-intervals'])
    const next = mergeResearchMarketRows(first.rows, [
      row(5),
      { ...row(15), isClosed: false },
      { ...row(15), low: 103 },
      row(12),
      row(15),
    ])
    expect(next.rows.slice(0, 2)).toEqual(first.rows)
    expect(next.rows.map(({ date }) => date)).toEqual([time(0), time(10), time(15)])
    expect(reasons(next)).toContain('late-or-overlapping-market-row-ignored')
    expect(reasons(next).filter((reason) => reason === 'invalid-or-unclosed-market-row')).toHaveLength(2)
  })

  it('bounds the retained market window and never mutates inputs', () => {
    const input = Array.from({ length: 5 }, (_, index) => row(index * 5))
    const before = structuredClone(input)
    const result = mergeResearchMarketRows([], input, { limit: 3 })
    expect(result.rows.map(({ date }) => date)).toEqual(input.slice(-3).map(({ date }) => date))
    expect(reasons(result)).toEqual(['market-retention-limit'])
    expect(input).toEqual(before)
  })
})
