import test from 'node:test'
import assert from 'node:assert/strict'
import { collectEthLpWindow } from './collect.mjs'
import { argument, quantity, SELECTORS, POOL_ADDRESS, FACTORY_ADDRESS, TOKEN_ADDRESSES, EVENT_TOPICS } from './abi.mjs'

const encode = (...values) => `0x${values.map(argument).join('')}`
const hash = (number) => `0x${BigInt(number).toString(16).padStart(64, '0')}`
const block = (number) => ({
  number: quantity(number),
  hash: hash(number),
  parentHash: hash(number - 1),
  timestamp: quantity(1700000000 + number * 12),
})
const encodeSymbol = (text) => encode(32, text.length) + Buffer.from(text).toString('hex').padEnd(64, '0')
const log = (type, height, index, data) => ({
  address: POOL_ADDRESS,
  blockNumber: quantity(height),
  blockHash: hash(height),
  transactionHash: hash(1000 + index),
  transactionIndex: quantity(index),
  logIndex: quantity(index),
  removed: false,
  topics: [EVENT_TOPICS[type], encode(1), encode(10), encode(20)],
  data,
})

function mockProvider({
  removed = false,
  reorg = false,
  gap = false,
  foreignToken = false,
  duplicate = false,
  checkpointTick = 0,
} = {}) {
  const calls = []
  const headerReads = new Map()
  const fixtures = [
    log('Collect', 100, 3, encode(1, 2, 3)),
    log('Burn', 99, 2, encode(0, 0, 0)),
    log('Mint', 99, 1, encode(1, 100, 20, 0)),
  ]
  if (removed) fixtures[0].removed = true
  if (duplicate) fixtures.push(structuredClone(fixtures[0]))
  function reply(request) {
    const { method, params, id } = request
    calls.push(request)
    let result
    if (method === 'eth_chainId') result = '0x1'
    else if (method === 'eth_getBlockByNumber') {
      const number = params[0] === 'finalized' ? 100 : Number(BigInt(params[0]))
      const count = headerReads.get(number) ?? 0
      headerReads.set(number, count + 1)
      result = block(number)
      if (gap && number === 99) result.parentHash = hash(3)
      if (reorg && number === 98 && count >= 1) result.hash = hash(9000)
    } else if (method === 'eth_getLogs') result = fixtures
    else if (method === 'eth_call') {
      const [{ to, data }, ref] = params
      assert.equal(ref.requireCanonical, true)
      assert.match(ref.blockHash, /^0x[0-9a-f]{64}$/)
      const height = Number(BigInt(ref.blockHash))
      assert.ok([98, 100].includes(height))
      const selector = data.slice(0, 10)
      const extra = data.slice(10)
      if (selector === SELECTORS.token0) result = encode(foreignToken ? 1 : TOKEN_ADDRESSES.USDC)
      else if (selector === SELECTORS.token1) result = encode(TOKEN_ADDRESSES.WETH)
      else if (selector === SELECTORS.fee) result = encode(500)
      else if (selector === SELECTORS.tickSpacing) result = encode(10)
      else if (selector === SELECTORS.factory) result = encode(FACTORY_ADDRESS)
      else if (selector === SELECTORS.getPool) result = encode(POOL_ADDRESS)
      else if (selector === SELECTORS.decimals) result = encode(to === TOKEN_ADDRESSES.USDC ? 6 : 18)
      else if (selector === SELECTORS.symbol) result = encodeSymbol(to === TOKEN_ADDRESSES.USDC ? 'USDC' : 'WETH')
      else if (selector === SELECTORS.slot0)
        result = encode(2n ** 96n, height === 100 ? checkpointTick : 0, 0, 1, 1, 0, 1)
      else if (selector === SELECTORS.liquidity) result = encode(1000)
      else if (selector === SELECTORS.tickBitmap) {
        const word = Number(BigInt.asIntN(256, BigInt(`0x${extra}`)))
        result = encode(word === -1 ? 1n << 255n : word === 0 ? 2 : 0)
      } else if (selector === SELECTORS.ticks) {
        const tick = Number(BigInt.asIntN(256, BigInt(`0x${extra}`)))
        result = encode(1000, tick < 0 ? 1000 : -1000, 0, 0, 0, 0, 0, 1)
      } else throw new Error(`Unknown selector ${selector}`)
    } else throw new Error(`Unexpected method ${method}`)
    return { jsonrpc: '2.0', id, result }
  }
  return {
    calls,
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body)
      const payload = Array.isArray(request) ? request.map(reply).reverse() : reply(request)
      return new Response(JSON.stringify(payload))
    },
  }
}

test('collects fixed finalized state, full headers, sorted ABI events and raw evidence', async () => {
  const mock = mockProvider({ duplicate: true, checkpointTick: 3000 })
  const bundle = await collectEthLpWindow({
    rpcUrl: 'https://example.invalid/key?token=secret',
    blockCount: 2,
    fetchImpl: mock.fetchImpl,
  })
  assert.equal(bundle.seed.block.number, 98)
  assert.equal(bundle.scan.fromBlock, 99)
  assert.equal(bundle.scan.toBlock, 100)
  assert.equal(bundle.scan.complete, true)
  assert.equal(bundle.scan.duplicateLogCount, 1)
  assert.deepEqual(
    bundle.blocks.map((item) => item.number),
    [98, 99, 100],
  )
  assert.deepEqual(
    bundle.events.map((item) => item.type),
    ['Mint', 'Burn', 'Collect'],
  )
  assert.equal(bundle.events[0].liquidityDeltaRaw, '100')
  assert.equal(bundle.events[1].liquidityDeltaRaw, '0')
  assert.equal(bundle.pool.baseTokenIndex, 1)
  assert.equal(bundle.pool.token0.decimals, 6)
  assert.equal(bundle.pool.token1.decimals, 18)
  assert.deepEqual(bundle.seed.coverage, { tickLower: -2560, tickUpper: 5110 })
  assert.deepEqual(bundle.checkpoint.coverage, bundle.seed.coverage)
  assert.equal(bundle.checkpoint.tick, 3000)
  assert.deepEqual(
    bundle.seed.ticks.map((item) => item.tick),
    [-10, 10],
  )
  assert.ok(!JSON.stringify(bundle).includes('secret'))
  assert.equal(bundle.provenance.finality, 'finalized')
  assert.equal(bundle.provenance.receiptProofVerified, false)
  assert.ok(mock.calls.filter((item) => item.method === 'eth_call').every((item) => typeof item.params[1] === 'object'))
})

test('rejects changed canonical boundaries, gaps, removed logs and wrong units', async () => {
  for (const [options, message] of [
    [{ reorg: true }, /Canonical boundary changed/],
    [{ gap: true }, /contiguous/],
    [{ removed: true }, /removed/],
    [{ foreignToken: true }, /canonical USDC/],
  ]) {
    const mock = mockProvider(options)
    await assert.rejects(collectEthLpWindow({ blockCount: 2, fetchImpl: mock.fetchImpl }), message)
  }
})

test('rejects unbounded windows before accessing RPC and rejects nonfinalized end blocks', async () => {
  const neverFetch = async () => {
    throw new Error('network must not run')
  }
  await assert.rejects(collectEthLpWindow({ blockCount: 2001, fetchImpl: neverFetch }), /blockCount/)
  await assert.rejects(collectEthLpWindow({ wordRadius: 5, fetchImpl: neverFetch }), /wordRadius/)
  await assert.rejects(collectEthLpWindow({ blockCount: 0, fetchImpl: neverFetch }), /blockCount/)
  const mock = mockProvider()
  await assert.rejects(collectEthLpWindow({ endBlock: 101, blockCount: 2, fetchImpl: mock.fetchImpl }), /finalized/)
})
