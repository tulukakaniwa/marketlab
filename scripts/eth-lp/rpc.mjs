import { readBoundedResponseText } from '../research-response.mjs'

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

// Read-only, bounded JSON-RPC transport. Never include an endpoint or raw server
// error in diagnostics: URL paths and query parameters can contain credentials.
export function createRpcClient({
  url,
  fetchImpl = globalThis.fetch,
  batchSize = 20,
  maxRetries = 2,
  retryDelayMs = 500,
  timeoutMs = 20000,
} = {}) {
  const endpoint = new URL(url)
  if (!['https:', 'http:'].includes(endpoint.protocol)) throw new Error('RPC must use HTTP(S)')
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 20) throw new Error('RPC batch limit is 20')
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 3) throw new Error('RPC retry limit is 3')
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5000)
    throw new Error('Invalid RPC retry delay')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new Error('RPC timeout limit is 30000ms')
  const allowed = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_call'])
  let nextId = 0
  let requestCount = 0

  async function request(calls, single = false) {
    const requests = calls.map(({ method, params }) => {
      if (!allowed.has(method)) throw new Error('Only whitelisted read-only RPC methods are allowed')
      return { jsonrpc: '2.0', id: ++nextId, method, params }
    })
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      let failure
      try {
        requestCount += 1
        const response = await fetchImpl(endpoint.href, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(single ? requests[0] : requests),
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!response.ok) {
          const error = new Error(`RPC HTTP ${response.status}`)
          error.retryable = response.status === 429 || response.status >= 500
          throw error
        }
        const text = await readBoundedResponseText(response, { maxBytes: MAX_RESPONSE_BYTES, errorPrefix: 'RPC' })
        const payload = JSON.parse(text)
        const responses = single ? [payload] : payload
        if (!Array.isArray(responses) || responses.length !== requests.length) {
          throw Object.assign(new Error('RPC batch response incomplete'), { retryable: false })
        }
        const indexed = new Map(responses.map((item) => [item?.id, item]))
        if (indexed.size !== requests.length) throw new Error('RPC response IDs are not unique')
        return requests.map(({ id, method }) => {
          const item = indexed.get(id)
          if (!item || item.jsonrpc !== '2.0') throw new Error('RPC response ID/version mismatch')
          if (item.error) {
            const error = new Error(`RPC ${method} failed (code ${Number(item.error.code)})`)
            error.code = Number(item.error.code)
            error.retryable = ![-32600, -32601, -32602].includes(error.code)
            throw error
          }
          if (!Object.hasOwn(item, 'result')) throw new Error('RPC result missing')
          return item.result
        })
      } catch (error) {
        // Preserve only our sanitized error labels, never fetch error URLs.
        failure = /^RPC /.test(error.message) ? error : new Error('RPC transport or response failure')
        if (error.retryable === false || attempt === maxRetries) throw failure
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)))
    }
    throw new Error('RPC retry limit exhausted')
  }
  return {
    async call(method, params) {
      return (await request([{ method, params }], true))[0]
    },
    async many(calls) {
      const results = []
      for (let start = 0; start < calls.length; start += batchSize) {
        results.push(...(await request(calls.slice(start, start + batchSize))))
      }
      return results
    },
    get requestCount() {
      return requestCount
    },
  }
}
