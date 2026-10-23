import { test } from 'node:test'
import assert from 'node:assert/strict'
import { researchLiveDevGuard, researchLiveProxy } from './research-live-proxy.mjs'

function route(overrides = {}) {
  let handler
  researchLiveDevGuard().configureServer({
    middlewares: {
      use: (value) => {
        handler = value
      },
    },
  })
  const request = {
    url: '/api/research-live/manifest',
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { host: '127.0.0.1:5178' },
    ...overrides,
  }
  const result = { passed: false, statusCode: null, body: null }
  handler(
    request,
    {
      set statusCode(value) {
        result.statusCode = value
      },
      end(body) {
        result.body = body
      },
    },
    () => {
      result.passed = true
    },
  )
  return result
}

test('only forwards read-only local research requests from loopback pages', () => {
  assert.equal(route().passed, true)
  assert.equal(
    route({ socket: { remoteAddress: '::1' }, headers: { host: 'localhost:5178', origin: 'http://localhost:5178' } })
      .passed,
    true,
  )
  for (const request of [
    { method: 'POST' },
    { socket: { remoteAddress: '192.168.1.2' } },
    { headers: { host: 'example.com:5178' } },
    { headers: { host: '127.0.0.1:5178', origin: 'https://example.com' } },
    { headers: { host: 'localhost.evil:5178' } },
    { headers: { host: 'localhost:5178', origin: 'null' } },
  ])
    assert.equal(route(request).statusCode, 403)
})

test('leaves normal static routes alone and fixes the proxy target', () => {
  assert.equal(route({ url: '/assets/app.js', socket: { remoteAddress: '192.168.1.2' } }).passed, true)
  assert.equal(researchLiveProxy.target, 'http://127.0.0.1:5180')
  assert.equal(researchLiveProxy.rewrite('/api/research-live/bundles/options/abc'), '/bundles/options/abc')
})
