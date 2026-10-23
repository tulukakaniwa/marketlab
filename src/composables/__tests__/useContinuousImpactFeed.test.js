import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContinuousImpactFeed } from '../useContinuousImpactFeed.js'
import { isLoopbackPage, readBoundedResponse, validateLiveManifest } from '../continuousImpactTransport.js'

const time = '2026-10-23T12:00:00.000Z'
const arrival = '2026-10-23T12:01:00.000Z'
const hash = (value) => value.repeat(64)
const record = (id = 'a', kind = 'lp', availableAt = time) => ({
  id: hash(id),
  sha256: hash(id),
  kind,
  availableAt,
  receivedAt: arrival,
  url: `/bundles/${kind}/${hash(id)}`,
})
const manifest = (records) => ({
  version: 1,
  sessionId: 'session-a',
  updatedAt: '2026-10-23T12:10:00.000Z',
  records,
  lanes: {},
})
const response = (body) => new Response(JSON.stringify(body), { status: 200 })
const report = (availableAt = time) => ({ status: 'ready', availableAt })
const location = { hostname: '127.0.0.1', protocol: 'http:' }
const row = (minute) => ({
  date: `2026-10-23T11:${minute}:00.000Z`,
  closeTime: Date.parse(`2026-10-23T11:${minute}:00Z`) + 299999,
  isClosed: true,
  open: 2000,
  high: 2001,
  low: 1999,
  close: 2000,
  volume: 10,
})
const controllers = []
function harness({ records = [record()], reports = [report()], fetchImpl, manualWorker = false } = {}) {
  const workers = []
  const fetcher =
    fetchImpl ??
    vi.fn(async (url) =>
      url.endsWith('/manifest') ? response(manifest(records)) : response({ sha256: url.split('/').at(-1), bundle: {} }),
    )
  const feed = createContinuousImpactFeed({
    location,
    fetchImpl: fetcher,
    now: () => Date.parse(arrival),
    workerFactory: () => {
      const index = workers.length
      const worker = {
        terminate: vi.fn(),
        postMessage: vi.fn((job) => {
          worker.reply = (next = reports[index]) =>
            worker.onmessage({ data: { id: job.id, result: { hashVerified: true, report: next, issues: [] } } })
          if (!manualWorker) queueMicrotask(() => worker.reply())
        }),
      }
      workers.push(worker)
      return worker
    },
  })
  controllers.push(feed)
  return { feed, fetcher, workers }
}
afterEach(() => {
  controllers.splice(0).forEach((feed) => feed.dispose())
  vi.useRealTimers()
})

describe('continuous research feed', () => {
  it('accepts only loopback pages and fixed bounded manifest URLs', () => {
    expect(isLoopbackPage(location)).toBe(true)
    expect(isLoopbackPage({ hostname: 'example.org', protocol: 'https:' })).toBe(false)
    expect(() => validateLiveManifest(manifest([{ ...record(), url: 'https://outside.invalid/data' }]))).toThrow()
    expect(() => validateLiveManifest(manifest(Array(865).fill(record())))).toThrow()
    expect(() => validateLiveManifest(manifest([record(), record()]))).toThrow()
  })
  it('verifies new snapshots once and preserves persisted reception time across refreshes', async () => {
    const { feed, fetcher, workers } = harness()
    expect(await feed.refresh()).toBe(true)
    expect(feed.lpHistory.value[0]).toMatchObject({
      availableAt: time,
      receivedAt: arrival,
      effectiveAvailableAt: arrival,
    })
    expect(await feed.refresh()).toBe(true)
    expect(feed.lpHistory.value).toHaveLength(1)
    expect(workers).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(workers[0].postMessage.mock.calls[0][0].scenario.enabled).toBe(false)
  })
  it('rejects manifest hash or original-time mismatches without exposing snapshots', async () => {
    const first = harness({ reports: [report(arrival)] })
    expect(await first.feed.refresh()).toBe(false)
    expect(first.feed.lpHistory.value).toEqual([])
    const second = harness({
      fetchImpl: vi.fn(async (url) =>
        response(url.endsWith('/manifest') ? manifest([record()]) : { sha256: hash('b'), bundle: {} }),
      ),
    })
    expect(await second.feed.refresh()).toBe(false)
    expect(second.workers).toHaveLength(0)
  })
  it('retains verified history on poll failure, reports error, and retries', async () => {
    const { feed, fetcher } = harness()
    await feed.refresh()
    fetcher.mockRejectedValueOnce(new Error('offline'))
    expect(await feed.refresh()).toBe(false)
    expect(feed.lpHistory.value).toHaveLength(1)
    expect(feed.state.value).toMatchObject({ phase: 'error', error: 'offline' })
    expect(await feed.refresh()).toBe(true)
    expect(feed.state.value.error).toBe('')
  })
  it('serializes polls and rejects a late worker result after pause', async () => {
    const { feed, workers, fetcher } = harness({ manualWorker: true })
    const pending = feed.refresh()
    await vi.waitFor(() => expect(workers).toHaveLength(1))
    expect(await feed.refresh()).toBe(false)
    expect(fetcher).toHaveBeenCalledTimes(2)
    feed.stop()
    workers[0].reply()
    expect(await pending).toBe(false)
    expect(workers[0].terminate).toHaveBeenCalled()
    expect(feed.lpHistory.value).toEqual([])
    expect(feed.state.value.phase).toBe('paused')
  })
  it('ignores changed timestamps on a previously verified identifier', async () => {
    const records = [record()]
    const { feed } = harness({ records })
    await feed.refresh()
    records[0] = { ...records[0], receivedAt: time }
    expect(await feed.refresh()).toBe(false)
    expect(feed.lpHistory.value[0].receivedAt).toBe(arrival)
  })
  it('appends closed market rows and refuses revised historical OHLC', async () => {
    const records = [record('a', 'market')]
    const rows = [row('50'), row('55')]
    const reports = [{ ...report(), rows, source: { symbol: 'ETHUSDT', timeframe: '5m', provider: 'Binance' } }]
    const { feed } = harness({ records, reports })
    await feed.refresh()
    records.push({ ...record('b', 'market', '2026-10-23T12:00:30.000Z'), receivedAt: '2026-10-23T12:02:00.000Z' })
    reports.push({ ...reports[0], availableAt: records[1].availableAt, rows: [{ ...rows[0], close: 2000.5 }, rows[1]] })
    await feed.refresh()
    expect(feed.marketRows.value[0].close).toBe(2000)
    expect(feed.marketRows.value).toHaveLength(2)
    expect(feed.marketHistory.value).toHaveLength(2)
    expect(feed.state.value.issues.some((issue) => issue.reason === 'market-revision-ignored')).toBe(true)
  })
  it('limits streamed bytes even without a content-length header', async () => {
    const controller = new AbortController()
    const result = new Response(new Uint8Array(16))
    await expect(readBoundedResponse(result, 8, controller.signal)).rejects.toThrow('大小限制')
  })
})
