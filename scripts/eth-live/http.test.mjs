import { test } from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { createLiveHttpServer } from './http.mjs'

test('HTTP is loopback, read-only, bounded, non-CORS and restricted to manifest IDs', async (t) => {
  const hash = 'a'.repeat(64)
  const reads = []
  const repository = {
    snapshot: () => ({ version: 1, sessionId: 'test', updatedAt: '2026-10-23T12:00:00Z', records: [] }),
    async read(kind, id) {
      reads.push([kind, id])
      return id === hash ? '{"bundle":"real-envelope"}' : null
    },
  }
  const server = createLiveHttpServer({ repository, scheduler: { snapshot: () => ({ market: { phase: 'ready' } }) } })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const manifest = await fetch(`${base}/manifest`)
  assert.equal(manifest.status, 200)
  assert.equal(manifest.headers.get('cache-control'), 'no-store')
  assert.equal(manifest.headers.get('access-control-allow-origin'), null)
  assert.equal((await manifest.json()).lanes.market.phase, 'ready')
  assert.equal((await fetch(`${base}/health`)).status, 200)
  assert.equal((await fetch(`${base}/manifest`, { method: 'POST' })).status, 405)
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = request(`${base}/manifest`, { headers: { Host: 'evil.example' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.once('error', reject)
    req.end()
  })
  assert.equal(hostileHostStatus, 403)
  assert.equal((await fetch(`${base}/manifest`, { headers: { origin: 'https://evil.example' } })).status, 403)
  for (const path of ['/bundles/market/%2e%2e', '/bundles/market/x', '/manifest?file=secret', '/other'])
    assert.equal((await fetch(base + path)).status, 404)
  assert.equal(reads.length, 0)
  assert.equal((await fetch(`${base}/bundles/market/${hash}`)).status, 200)
  assert.deepEqual(reads, [['market', hash]])
  assert.equal((await fetch(`${base}/bundles/lp/${'b'.repeat(64)}`)).status, 404)
})

test('HTTP permits at most three active bundle reads and hides internal filesystem errors', async (t) => {
  const pending = []
  const server = createLiveHttpServer({
    repository: {
      snapshot: () => ({}),
      read: () =>
        new Promise((_resolve, reject) => {
          pending.push(reject)
        }),
    },
    scheduler: { snapshot: () => ({}) },
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.closeAllConnections()
    server.close()
  })
  const url = `http://127.0.0.1:${server.address().port}/bundles/market/${'a'.repeat(64)}`
  const responses = [fetch(url), fetch(url), fetch(url)]
  for (let attempts = 0; pending.length < 3 && attempts < 100; attempts++)
    await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(pending.length, 3)
  assert.equal((await fetch(url)).status, 503)
  for (const reject of pending) reject(new Error('/private/secret RPC=https://token@example.invalid'))
  for (const response of await Promise.all(responses)) {
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { error: 'local-research-unavailable' })
  }
})
