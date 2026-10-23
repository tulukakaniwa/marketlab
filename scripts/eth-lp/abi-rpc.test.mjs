import test from 'node:test'
import assert from 'node:assert/strict'
import { words, uint, int, argument, bitmapTicks, symbol, numberQuantity, EVENT_TOPICS } from './abi.mjs'
import { POOL_EVENT_TOPICS } from '../../src/domain/market-impact/uniswapV3EventEvidence.js'
import { createRpcClient } from './rpc.mjs'

const ok = (payload) => new Response(JSON.stringify(payload))

test('ABI keeps uint128 precision and validates signed extension', () => {
  const exact = (1n << 127n) + 123n
  assert.equal(uint(argument(exact), 128), exact)
  assert.equal(int(argument(-12345), 24), -12345n)
  assert.throws(() => int('0'.repeat(58) + 'ffffff', 24), /sign extension/)
  assert.throws(() => uint(argument(1n << 128n), 128), /uint128/)
  assert.throws(() => words('0x1234'), /Malformed/)
  assert.throws(() => numberQuantity('0x20000000000000'), /Unsafe/)
  assert.deepEqual(EVENT_TOPICS, POOL_EVENT_TOPICS)
})

test('negative bitmap word and bit 255 map to the correct ticks', () => {
  const bits = (1n << 255n) + 1n
  assert.deepEqual(bitmapTicks(`0x${argument(bits)}`, -1, 10), [-2560, -10])
  assert.deepEqual(bitmapTicks(`0x${argument(1)}`, 0, 10), [0])
})

test('symbol ABI rejects incorrect offsets or lengths', () => {
  const text = Buffer.from('WETH').toString('hex').padEnd(64, '0')
  assert.equal(symbol(`0x${argument(32)}${argument(4)}${text}`), 'WETH')
  assert.throws(() => symbol(`0x${argument(64)}${argument(4)}${text}`), /offset/)
})

test('RPC bounds batches, reorders responses by id, and forbids mutations', async () => {
  const sizes = []
  const client = createRpcClient({
    url: 'https://example.invalid/private-key?token=secret',
    fetchImpl: async (_url, init) => {
      const requests = JSON.parse(init.body)
      sizes.push(requests.length)
      return ok(requests.toReversed().map((request) => ({ jsonrpc: '2.0', id: request.id, result: request.params[0] })))
    },
  })
  const results = await client.many(
    Array.from({ length: 45 }, (_, index) => ({ method: 'eth_getBlockByNumber', params: [index, false] })),
  )
  assert.deepEqual(
    results,
    Array.from({ length: 45 }, (_, index) => index),
  )
  assert.deepEqual(sizes, [20, 20, 5])
  await assert.rejects(client.call('eth_sendRawTransaction', ['secret']), /read-only/)
})

test('RPC retries a transient HTTP error and redacts transport URLs', async () => {
  let attempts = 0
  const client = createRpcClient({
    url: 'https://example.invalid/secret',
    retryDelayMs: 0,
    fetchImpl: async (_url, init) => {
      if (attempts++ === 0) return { ok: false, status: 429 }
      const request = JSON.parse(init.body)
      return ok({ jsonrpc: '2.0', id: request.id, result: '0x1' })
    },
  })
  assert.equal(await client.call('eth_chainId', []), '0x1')
  assert.equal(attempts, 2)
  const failed = createRpcClient({
    url: 'https://example.invalid/secret',
    maxRetries: 0,
    fetchImpl: async () => {
      throw new Error('fetch https://example.invalid/secret failed')
    },
  })
  await assert.rejects(failed.call('eth_chainId', []), (error) => !error.message.includes('secret'))
})

test('RPC rejects incomplete batches and server error messages do not leak credentials', async () => {
  const missing = createRpcClient({ url: 'https://example.invalid', maxRetries: 0, fetchImpl: async () => ok([]) })
  await assert.rejects(missing.many([{ method: 'eth_chainId', params: [] }]), /incomplete/)
  const failed = createRpcClient({
    url: 'https://example.invalid',
    maxRetries: 0,
    fetchImpl: async (_url, init) =>
      ok({ jsonrpc: '2.0', id: JSON.parse(init.body).id, error: { code: -32602, message: 'invalid url /secret' } }),
  })
  await assert.rejects(
    failed.call('eth_chainId', []),
    (error) => error.code === -32602 && !error.message.includes('secret'),
  )
})

test('RPC oversized response is cancelled and never retried', async () => {
  let requests = 0
  let cancellations = 0
  const client = createRpcClient({
    url: 'https://example.invalid',
    retryDelayMs: 0,
    fetchImpl: async () => {
      requests += 1
      return new Response(
        new ReadableStream(
          {
            cancel() {
              cancellations += 1
            },
          },
          { highWaterMark: 0 },
        ),
        { headers: { 'content-length': String(16 * 1024 * 1024 + 1) } },
      )
    },
  })
  await assert.rejects(
    client.call('eth_chainId', []),
    (error) => error.code === 'RESPONSE_TOO_LARGE' && error.retryable === false,
  )
  assert.equal(requests, 1)
  assert.equal(cancellations, 1)
})
