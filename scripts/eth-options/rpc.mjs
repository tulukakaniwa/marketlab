import { readBoundedResponseText } from '../research-response.mjs'

// Public REST/JSON-RPC market-data methods only. Fixed production origin; no
// credentials, configurable URLs, redirects, account methods, or order methods.
export const DERIBIT_API_BASE = 'https://www.deribit.com/api/v2/'
const METHODS = new Set([
  'public/get_instruments',
  'public/get_last_trades_by_currency',
  'public/ticker',
  'public/get_instrument',
  'public/get_order_book',
])
const OPTION_NAME = /^ETH-[A-Z0-9.]+-[0-9.]+-[CP]$/
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

// Preserve integer lexemes before Number can round IDs or nanosecond clocks.
// Quoted JSON strings (including escaped quotes/backslashes) are skipped whole.
export function parseDeribitJson(text) {
  const safeInteger = BigInt(Number.MAX_SAFE_INTEGER)
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g
  const normalized = text.replace(tokens, (token, offset) => {
    if (token.startsWith('"')) return token
    // A rewrite must not accidentally turn an invalid numeric object key into
    // a valid quoted key; the final JSON.parse validates the remaining syntax.
    if (/^\s*:/.test(text.slice(offset + token.length))) {
      throw Object.assign(new Error('Deribit response contains an invalid JSON key'), { retryable: false })
    }
    if (/^-?\d+$/.test(token)) {
      const value = BigInt(token)
      return value > safeInteger || value < -safeInteger ? JSON.stringify(token) : token
    }
    const value = Number(token)
    // Ordinary decimal prices retain JSON Number semantics. Large scientific
    // or fractional representations are rejected instead of silently rounded.
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw Object.assign(new Error('Deribit response contains an unsupported large decimal or exponent'), {
        retryable: false,
      })
    }
    return token
  })
  return JSON.parse(normalized)
}

function validateRequest(method, params) {
  if (!METHODS.has(method)) throw new Error('Deribit method is not in the public read-only whitelist')
  const keys = Object.keys(params).sort().join(',')
  if (
    method === 'public/get_instruments' &&
    (keys !== 'currency,expired,kind' ||
      params.currency !== 'ETH' ||
      params.kind !== 'option' ||
      params.expired !== false)
  )
    throw new Error('Invalid instruments request')
  if (
    method === 'public/get_last_trades_by_currency' &&
    (keys !== 'count,currency,kind,sorting' ||
      params.currency !== 'ETH' ||
      params.kind !== 'option' ||
      params.sorting !== 'desc' ||
      !Number.isInteger(params.count) ||
      params.count < 1 ||
      params.count > 30)
  )
    throw new Error('Invalid bounded trades request')
  if (
    method === 'public/ticker' &&
    (keys !== 'instrument_name' || !OPTION_NAME.test(params.instrument_name) || params.instrument_name.length > 80)
  )
    throw new Error('Invalid ETH option ticker request')
  if (
    method === 'public/get_instrument' &&
    (keys !== 'instrument_name' || params.instrument_name !== 'ETH-PERPETUAL')
  ) {
    throw new Error('Only the ETH-PERPETUAL instrument is allowed')
  }
  if (
    method === 'public/get_order_book' &&
    (keys !== 'depth,instrument_name' || params.instrument_name !== 'ETH-PERPETUAL' || params.depth !== 20)
  )
    throw new Error('Only ETH-PERPETUAL book depth 20 is allowed')
}

export function createDeribitClient({
  fetchImpl = globalThis.fetch,
  now = Date.now,
  maxRetries = 2,
  retryDelayMs = 500,
  timeoutMs = 15000,
} = {}) {
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) throw new Error('Deribit retry limit is 2')
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 2000) throw new Error('Invalid retry delay')
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 20000)
    throw new Error('Deribit timeout limit is 20000ms')
  const observations = []
  let logicalCalls = 0
  let requestCount = 0
  return {
    async call(method, params) {
      validateRequest(method, params)
      if (++logicalCalls > 16) throw new Error('Deribit snapshot call limit exceeded')
      const url = new URL(method, DERIBIT_API_BASE)
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
      const requestStartedAt = new Date(now()).toISOString()
      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          requestCount += 1
          const response = await fetchImpl(url.href, {
            method: 'GET',
            redirect: 'error',
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (!response.ok)
            throw Object.assign(new Error(`Deribit HTTP ${response.status}`), {
              retryable: response.status === 429 || response.status >= 500,
            })
          const text = await readBoundedResponseText(response, { maxBytes: MAX_RESPONSE_BYTES, errorPrefix: 'Deribit' })
          const payload = parseDeribitJson(text)
          if (payload.error)
            throw Object.assign(new Error(`Deribit API error ${Number(payload.error.code)}`), {
              retryable: [10028, -32603].includes(Number(payload.error.code)),
            })
          if (
            payload.jsonrpc !== '2.0' ||
            !Object.hasOwn(payload, 'result') ||
            payload.result === null ||
            payload.testnet === true
          ) {
            throw Object.assign(new Error('Deribit response is missing production result'), { retryable: false })
          }
          const responseReceivedAt = new Date(now()).toISOString()
          if (Date.parse(responseReceivedAt) < Date.parse(requestStartedAt))
            throw new Error('Deribit local clock moved backwards')
          observations.push({
            method,
            params: { ...params },
            requestStartedAt,
            responseReceivedAt,
            attempts: attempt + 1,
            ...(Number.isSafeInteger(payload.usIn) ? { serverReceivedAtMicros: payload.usIn } : {}),
            ...(Number.isSafeInteger(payload.usOut) ? { serverSentAtMicros: payload.usOut } : {}),
          })
          return payload.result
        } catch (error) {
          // Remote error bodies and fetch diagnostics can contain URLs. Expose
          // only controlled labels, never the server's error.message.
          const safe = /^Deribit (?:HTTP \d+|API error -?\d+|response |local clock )/.test(error.message)
            ? error
            : new Error('Deribit transport or JSON response failure')
          if (error.retryable === false || attempt === maxRetries) throw safe
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)))
      }
      throw new Error('Deribit retry limit exhausted')
    },
    get observations() {
      return structuredClone(observations)
    },
    get requestCount() {
      return requestCount
    },
  }
}
