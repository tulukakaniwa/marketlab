import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeribitClient, parseDeribitJson } from './rpc.mjs'
const params = { currency: 'ETH', kind: 'option', expired: false }
const response = (payload) => new Response(JSON.stringify(payload))

test('whitelist rejects mutations, extra secrets, excessive limits and other markets before fetch', async () => {
  const client = createDeribitClient({
    fetchImpl: async () => {
      throw new Error('network must not run')
    },
  })
  await assert.rejects(client.call('private/buy', {}), /whitelist/)
  await assert.rejects(client.call('public/get_instruments', { ...params, token: 'secret' }), /instruments request/)
  await assert.rejects(
    client.call('public/get_order_book', { instrument_name: 'ETH-PERPETUAL', depth: 1000 }),
    /depth 20/,
  )
  await assert.rejects(client.call('public/get_instrument', { instrument_name: 'BTC-PERPETUAL' }), /ETH-PERPETUAL/)
})

test('429 retry stays bounded and uses production GET without a body', async () => {
  let attempts = 0
  const client = createDeribitClient({
    retryDelayMs: 0,
    fetchImpl: async (url, init) => {
      assert.ok(url.startsWith('https://www.deribit.com/api/v2/public/get_instruments?'))
      assert.equal(init.method, 'GET')
      assert.equal(init.redirect, 'error')
      assert.equal(init.body, undefined)
      if (attempts++ === 0) return { ok: false, status: 429 }
      return response({ jsonrpc: '2.0', testnet: false, result: [] })
    },
  })
  assert.deepEqual(await client.call('public/get_instruments', params), [])
  assert.equal(attempts, 2)
  assert.equal(client.observations[0].attempts, 2)
})

test('testnet, missing result and network errors cannot produce market data', async () => {
  for (const payload of [{ jsonrpc: '2.0', result: [], testnet: true }, { jsonrpc: '2.0' }]) {
    const client = createDeribitClient({ maxRetries: 0, fetchImpl: async () => response(payload) })
    await assert.rejects(client.call('public/get_instruments', params), /production result/)
  }
  const failed = createDeribitClient({
    maxRetries: 0,
    fetchImpl: async () => {
      throw new Error('https://private/secret')
    },
  })
  await assert.rejects(failed.call('public/get_instruments', params), (error) => !error.message.includes('secret'))
})

test('large raw integer lexemes are preserved at every depth before JSON Number parsing', () => {
  const raw = String.raw`{"nested":{"starbase_match_id":239365520258773001,"starbase_timestamp":1792758787226619601},"rows":[-9007199254740992,9007199254740991,0.015,3.125e-4],"label":"239365520258773001 with \"quote\" and \\ slash","9007199254740993":"unchanged"}`
  const result = parseDeribitJson(raw)
  assert.equal(result.nested.starbase_match_id, '239365520258773001')
  assert.equal(result.nested.starbase_timestamp, '1792758787226619601')
  assert.deepEqual(result.rows, ['-9007199254740992', Number.MAX_SAFE_INTEGER, 0.015, 0.0003125])
  assert.equal(result.label, '239365520258773001 with "quote" and \\ slash')
  assert.equal(result['9007199254740993'], 'unchanged')
})

test('large exponent and decimal forms are rejected rather than rounded into data', () => {
  for (const value of ['9.007199254740993e15', '9007199254740993e0', '1e309', '9007199254740993.0']) {
    assert.throws(() => parseDeribitJson(`{"value":${value}}`), /unsupported large decimal or exponent/)
  }
  assert.throws(() => parseDeribitJson('{9007199254740993:1}'), /invalid JSON key/)
  assert.throws(() => parseDeribitJson('{"value":012345678901234567890}'), SyntaxError)
})

test('transport preserves unsafe nested API integers without serializing rounded Numbers', async () => {
  const client = createDeribitClient({
    fetchImpl: async () =>
      new Response(
        '{"jsonrpc":"2.0","testnet":false,"result":[{"starbase_match_id":239365520258773000,"starbase_timestamp":1792758787226619600,"price":0.00075}]}',
      ),
  })
  const result = await client.call('public/get_instruments', params)
  assert.deepEqual(result, [
    { starbase_match_id: '239365520258773000', starbase_timestamp: '1792758787226619600', price: 0.00075 },
  ])
})

test('Deribit oversized response is cancelled and never retried', async () => {
  let requests = 0
  let cancellations = 0
  const client = createDeribitClient({
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
    client.call('public/get_instruments', params),
    (error) => error.code === 'RESPONSE_TOO_LARGE' && error.retryable === false,
  )
  assert.equal(requests, 1)
  assert.equal(cancellations, 1)
})
