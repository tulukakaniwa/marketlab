import { createServer } from 'node:http'
import { BUNDLE_LIMITS } from './persistence.mjs'

const LOOPBACK_HOST = /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/
const LOOPBACK_IP = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const MAX_CONTROL_BYTES = 1024 * 1024

export function createLiveHttpServer({ repository, scheduler }) {
  let active = 0
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    function send(status, value, limit = MAX_CONTROL_BYTES) {
      if (response.destroyed) return
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      if (Buffer.byteLength(text) > limit) {
        response.writeHead(413).end('{"error":"response-limit"}')
        return
      }
      response.writeHead(status).end(text)
    }
    if (!LOOPBACK_IP.has(request.socket.remoteAddress) || !LOOPBACK_HOST.test(request.headers.host || '')) {
      send(403, { error: 'loopback-only' })
      return
    }
    if (request.headers.origin) {
      let permitted = false
      try {
        const origin = new URL(request.headers.origin)
        permitted = origin.protocol === 'http:' && LOOPBACK_HOST.test(origin.host)
      } catch {
        /* Invalid origins are denied without reflecting their value. */
      }
      if (!permitted) {
        send(403, { error: 'origin-denied' })
        return
      }
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET')
      send(405, { error: 'read-only' })
      return
    }
    if (++active > 3) {
      active--
      send(503, { error: 'busy' })
      return
    }
    let released = false
    const release = () => {
      if (!released) active--
      released = true
    }
    response.once('finish', release)
    response.once('close', release)
    try {
      if (request.url === '/health') {
        const { sessionId, updatedAt } = repository.snapshot()
        send(200, { version: 1, sessionId, updatedAt, lanes: scheduler.snapshot() })
      } else if (request.url === '/manifest') {
        send(200, { ...repository.snapshot(), lanes: scheduler.snapshot() })
      } else {
        const match = /^\/bundles\/(market|lp|options)\/([a-f0-9]{64})$/.exec(request.url || '')
        if (!match) send(404, { error: 'not-found' })
        else {
          const text = await repository.read(match[1], match[2])
          if (text === null) send(404, { error: 'not-found' })
          else send(200, text, BUNDLE_LIMITS[match[1]])
        }
      }
    } catch {
      send(503, { error: 'local-research-unavailable' })
    }
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.keepAliveTimeout = 5000
  server.maxHeadersCount = 32
  server.timeout = 15000
  server.maxConnections = 16
  return server
}
