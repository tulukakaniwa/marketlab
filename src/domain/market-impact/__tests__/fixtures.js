import { POOL_EVENT_TOPICS } from '../uniswapV3EventEvidence.js'
import { getSqrtRatioAtTick } from '../uniswapV3Math.js'

export const hashFor = (value) => `0x${BigInt(value).toString(16).padStart(64, '0')}`
const word = (value) => BigInt.asUintN(256, BigInt(value)).toString(16).padStart(64, '0')
const addressTopic = `0x${'0'.repeat(24)}${'a'.repeat(40)}`
const actorWord = addressTopic.slice(2)
const hex = (value) => `0x${value.toString(16)}`
export const sqrtAt = (tick) => getSqrtRatioAtTick(tick).toString()

export function fixtureBlock(number) {
  return { number, hash: hashFor(number), parentHash: hashFor(number - 1), timestamp: 1700000000 + (number - 100) * 12 }
}

export function fixtureEvent(type, blockNumber, values = {}) {
  const block = fixtureBlock(blockNumber)
  return {
    type,
    blockNumber,
    blockHash: block.hash,
    transactionHash: hashFor(10000 + blockNumber),
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
    eventTime: new Date(block.timestamp * 1000).toISOString(),
    ...values,
  }
}

export function rawLogForEvent(event, poolAddress) {
  const fields =
    event.type === 'Swap'
      ? [
          word(event.amount0Raw),
          word(event.amount1Raw),
          word(event.sqrtPriceX96),
          word(event.liquidity),
          word(event.tick),
        ]
      : event.type === 'Collect'
        ? [actorWord, word(event.amount0Raw), word(event.amount1Raw)]
        : [
            ...(event.type === 'Mint' ? [actorWord] : []),
            word(BigInt(event.liquidityDeltaRaw) < 0n ? -BigInt(event.liquidityDeltaRaw) : event.liquidityDeltaRaw),
            word(event.amount0Raw),
            word(event.amount1Raw),
          ]
  return {
    address: poolAddress,
    blockNumber: hex(event.blockNumber),
    blockHash: event.blockHash,
    transactionHash: event.transactionHash,
    transactionIndex: hex(event.transactionIndex),
    logIndex: hex(event.logIndex),
    removed: event.removed,
    topics:
      event.type === 'Swap'
        ? [POOL_EVENT_TOPICS.Swap, addressTopic, addressTopic]
        : [POOL_EVENT_TOPICS[event.type], addressTopic, `0x${word(event.tickLower)}`, `0x${word(event.tickUpper)}`],
    data: `0x${fields.join('')}`,
  }
}

export function refreshRawLogs(bundle) {
  bundle.rawLogs = bundle.events.map((event) => rawLogForEvent(event, bundle.pool.poolAddress))
  return bundle
}

// Synthetic deterministic protocol fixture, not a captured on-chain market observation.
// Expected endpoint is declared independently of replay; fixture flow amounts are illustrative.
export function makeReplayFixture() {
  const pool = {
    chainId: 1,
    poolAddress: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
    token0: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
    token1: { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', decimals: 18 },
    baseTokenIndex: 1,
    feePips: 500,
    tickSpacing: 10,
  }
  const seed = {
    block: fixtureBlock(100),
    sqrtPriceX96: sqrtAt(200005),
    tick: 200005,
    liquidity: '1000000000000000',
    coverage: { tickLower: 199900, tickUpper: 200100 },
    ticks: [
      { tick: 199940, liquidityGross: '1000000000000000', liquidityNet: '1000000000000000' },
      { tick: 200060, liquidityGross: '1000000000000000', liquidityNet: '-1000000000000000' },
    ],
  }
  const events = [
    fixtureEvent('Mint', 101, {
      tickLower: 199990,
      tickUpper: 200020,
      liquidityDeltaRaw: '200000000000000',
      amount0Raw: '30000',
      amount1Raw: '7000000000000000',
    }),
    fixtureEvent('Swap', 102, {
      amount0Raw: '-100000',
      amount1Raw: '500000000000000',
      sqrtPriceX96: sqrtAt(200025),
      tick: 200025,
      liquidity: '1000000000000000',
    }),
    fixtureEvent('Burn', 103, {
      tickLower: 199940,
      tickUpper: 200060,
      liquidityDeltaRaw: '-100000000000000',
      amount0Raw: '20000',
      amount1Raw: '5000000000000000',
    }),
    fixtureEvent('Collect', 104, {
      tickLower: 199940,
      tickUpper: 200060,
      amount0Raw: '20000',
      amount1Raw: '5000000000000000',
    }),
  ]
  const checkpoint = {
    block: fixtureBlock(104),
    sqrtPriceX96: sqrtAt(200025),
    tick: 200025,
    liquidity: '900000000000000',
    coverage: { ...seed.coverage },
    ticks: [
      { tick: 199940, liquidityGross: '900000000000000', liquidityNet: '900000000000000' },
      { tick: 199990, liquidityGross: '200000000000000', liquidityNet: '200000000000000' },
      { tick: 200020, liquidityGross: '200000000000000', liquidityNet: '-200000000000000' },
      { tick: 200060, liquidityGross: '900000000000000', liquidityNet: '-900000000000000' },
    ],
  }
  return refreshRawLogs({
    schemaVersion: 1,
    pool,
    seed,
    checkpoint,
    events,
    blocks: Array.from({ length: 5 }, (_, index) => fixtureBlock(100 + index)),
    scan: { fromBlock: 101, toBlock: 104, complete: true },
    provenance: {
      source: 'ethereum-json-rpc',
      finality: 'finalized',
      fetchedAt: '2023-11-14T22:16:00.000Z',
      availableAt: '2023-11-14T22:16:00.000Z',
      fixture: true,
    },
  })
}
