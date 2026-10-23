import { decodePoolLog, POOL_EVENT_TOPICS } from '../../src/domain/market-impact/uniswapV3EventEvidence.js'
import { createRpcClient } from './rpc.mjs'
import {
  SELECTORS,
  POOL_ADDRESS,
  FACTORY_ADDRESS,
  TOKEN_ADDRESSES,
  words,
  uint,
  int,
  address,
  argument,
  quantity,
  numberQuantity,
  symbol,
  header,
  bitmapTicks,
} from './abi.mjs'

export const DEFAULT_RPC_URL = 'https://ethereum-rpc.publicnode.com'
const MAX_BLOCKS = 2000
const MAX_TICKS = 2304
const MAX_LOGS = 50000
const blockRef = (block) => ({ blockHash: block.hash, requireCanonical: true })
const callAt = (block, to, data) => ({ method: 'eth_call', params: [{ to, data }, blockRef(block)] })

/** Collect one bounded finalized window; no filesystem writes and no synthetic fallback.
 * complete means every requested log range returned successfully. It is not a
 * receipt proof or a guarantee that an upstream provider never omitted a log.
 */
export async function collectEthLpWindow({
  rpcUrl = DEFAULT_RPC_URL,
  blockCount = 100,
  wordRadius = 1,
  endBlock,
  onProgress = () => {},
  fetchImpl,
} = {}) {
  if (!Number.isInteger(blockCount) || blockCount < 1 || blockCount > MAX_BLOCKS) {
    throw new Error(`blockCount must be an integer in [1, ${MAX_BLOCKS}]`)
  }
  if (!Number.isInteger(wordRadius) || wordRadius < 0 || wordRadius > 4) {
    throw new Error('wordRadius must be an integer in [0, 4]')
  }
  const rpc = createRpcClient({ url: rpcUrl, fetchImpl })
  const startedAt = new Date().toISOString()
  const chainId = numberQuantity(await rpc.call('eth_chainId', []))
  if (chainId !== 1) throw new Error('This collector requires Ethereum mainnet chainId 1')
  const finalized = header(await rpc.call('eth_getBlockByNumber', ['finalized', false]))
  const last = endBlock === undefined ? finalized.number : parseBlock(endBlock)
  if (last > finalized.number) throw new Error('endBlock must be finalized')
  const first = last - blockCount
  if (first < 0) throw new Error('Window starts before genesis')
  onProgress({ phase: 'headers', fromBlock: first, toBlock: last })
  const blocks = (
    await rpc.many(
      Array.from({ length: blockCount + 1 }, (_, index) => ({
        method: 'eth_getBlockByNumber',
        params: [quantity(first + index), false],
      })),
    )
  ).map(header)
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block.number !== first + index) throw new Error('Block header gap or wrong height')
    if (index && (block.parentHash !== blocks[index - 1].hash || block.timestamp <= blocks[index - 1].timestamp)) {
      throw new Error('Block headers are not one contiguous ordered chain')
    }
  }
  const seedBlock = blocks[0]
  const checkpointBlock = blocks.at(-1)
  if (last === finalized.number && checkpointBlock.hash !== finalized.hash) throw new Error('Finalized block changed')
  const pool = await readPool(rpc, seedBlock, chainId)
  onProgress({ phase: 'seed', blockNumber: first })
  const seed = await readSnapshot(rpc, pool, seedBlock, { wordRadius })
  onProgress({ phase: 'logs', fromBlock: first + 1, toBlock: last })
  const scanned = []
  for (let start = first + 1; start <= last; start += 25) {
    scanned.push(...(await readLogs(rpc, start, Math.min(last, start + 24))))
    if (scanned.length > MAX_LOGS) throw new Error('Window exceeds raw log limit; reduce blockCount')
  }
  const byHeight = new Map(blocks.map((block) => [block.number, block]))
  const unique = new Map()
  for (const log of scanned) {
    if (log.address?.toLowerCase() !== POOL_ADDRESS || log.removed !== false) {
      throw new Error('Foreign or removed pool log')
    }
    const height = numberQuantity(log.blockNumber)
    const block = byHeight.get(height)
    if (height <= first || !block || block.hash !== log.blockHash?.toLowerCase()) {
      throw new Error('Log does not belong to the scanned canonical window')
    }
    const identity = `${block.hash}:${numberQuantity(log.logIndex)}`
    if (unique.has(identity) && JSON.stringify(unique.get(identity)) !== JSON.stringify(log)) {
      throw new Error('Conflicting logs share one block/log identity')
    }
    unique.set(identity, log)
  }
  const rawLogs = [...unique.values()].sort(
    (a, b) =>
      numberQuantity(a.blockNumber) - numberQuantity(b.blockNumber) ||
      numberQuantity(a.transactionIndex) - numberQuantity(b.transactionIndex) ||
      numberQuantity(a.logIndex) - numberQuantity(b.logIndex),
  )
  const events = rawLogs.map((log) => decodePoolLog(log, byHeight.get(numberQuantity(log.blockNumber))))
  onProgress({ phase: 'checkpoint', blockNumber: last, eventCount: events.length })
  const checkpoint = await readSnapshot(rpc, pool, checkpointBlock, { coverage: seed.coverage })
  // Pin every state read to a hash, then re-read both boundary heights. Contiguous
  // parent links bind the intermediate headers to the rechecked checkpoint.
  const verification = (
    await rpc.many(
      [seedBlock, checkpointBlock].map((block) => ({
        method: 'eth_getBlockByNumber',
        params: [quantity(block.number), false],
      })),
    )
  ).map(header)
  if (verification[0].hash !== seedBlock.hash || verification[1].hash !== checkpointBlock.hash) {
    throw new Error('Canonical boundary changed during collection; discard window')
  }
  const fetchedAt = new Date().toISOString()
  if (Date.parse(fetchedAt) < checkpointBlock.timestamp * 1000) throw new Error('Local clock precedes checkpoint')
  onProgress({ phase: 'complete', eventCount: events.length, requestCount: rpc.requestCount })
  return {
    schemaVersion: 1,
    pool,
    seed,
    checkpoint,
    events,
    blocks,
    rawLogs,
    scan: {
      fromBlock: first + 1,
      toBlock: last,
      complete: true,
      gaps: [],
      duplicateLogCount: scanned.length - rawLogs.length,
      rawLogCount: rawLogs.length,
      completenessBasis: 'successful-bounded-rpc-ranges-and-contiguous-headers',
    },
    provenance: {
      source: 'ethereum-json-rpc',
      startedAt,
      fetchedAt,
      availableAt: fetchedAt,
      finality: 'finalized',
      finalizedHead: finalized,
      canonicalBoundaryVerified: true,
      stateBlockBinding: 'EIP-1898-blockHash-requireCanonical',
      requestCount: rpc.requestCount,
      maxBlockCount: MAX_BLOCKS,
      maxWordRadius: 4,
      tickCoverage: 'bounded-bitmap-words',
      receiptProofVerified: false,
    },
  }
}

function parseBlock(value) {
  let parsed
  try {
    parsed = Number(BigInt(value))
  } catch {
    throw new Error('Invalid endBlock')
  }
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('Invalid endBlock')
  return parsed
}

async function readPool(rpc, block, chainId) {
  const raw = await rpc.many(
    ['token0', 'token1', 'fee', 'tickSpacing', 'factory'].map((key) => callAt(block, POOL_ADDRESS, SELECTORS[key])),
  )
  const token0Address = address(words(raw[0], 1)[0])
  const token1Address = address(words(raw[1], 1)[0])
  const feePips = Number(uint(words(raw[2], 1)[0], 24))
  const tickSpacing = Number(int(words(raw[3], 1)[0], 24))
  const factoryAddress = address(words(raw[4], 1)[0])
  if (
    token0Address !== TOKEN_ADDRESSES.USDC ||
    token1Address !== TOKEN_ADDRESSES.WETH ||
    feePips !== 500 ||
    tickSpacing !== 10 ||
    factoryAddress !== FACTORY_ADDRESS
  ) {
    throw new Error('Pool metadata does not match canonical USDC/WETH 0.05%')
  }
  const tokens = [token0Address, token1Address]
  const metadata = await rpc.many(
    tokens.flatMap((token) => ['decimals', 'symbol'].map((key) => callAt(block, token, SELECTORS[key]))),
  )
  const [token0, token1] = tokens.map((token, index) => ({
    address: token,
    decimals: Number(uint(words(metadata[index * 2], 1)[0], 8)),
    symbol: symbol(metadata[index * 2 + 1]),
  }))
  if (token0.decimals !== 6 || token1.decimals !== 18 || token0.symbol !== 'USDC' || token1.symbol !== 'WETH') {
    throw new Error('Token units or symbols do not match canonical USDC/WETH')
  }
  const registered = await rpc.call('eth_call', [
    {
      to: FACTORY_ADDRESS,
      data: SELECTORS.getPool + argument(token0Address) + argument(token1Address) + argument(feePips),
    },
    blockRef(block),
  ])
  if (address(words(registered, 1)[0]) !== POOL_ADDRESS) throw new Error('Factory pool registration mismatch')
  return {
    chainId,
    poolAddress: POOL_ADDRESS,
    factoryAddress,
    token0,
    token1,
    baseTokenIndex: 1,
    feePips,
    tickSpacing,
    quoteConvention: 'USDC-per-WETH',
  }
}

async function readSnapshot(rpc, pool, block, { wordRadius, coverage }) {
  const raw = await rpc.many(['slot0', 'liquidity'].map((key) => callAt(block, POOL_ADDRESS, SELECTORS[key])))
  const state = words(raw[0], 7)
  const sqrtPriceX96 = uint(state[0], 160).toString()
  const tick = Number(int(state[1], 24))
  const liquidity = uint(words(raw[1], 1)[0], 128).toString()
  if (tick < -887272 || tick > 887272 || sqrtPriceX96 === '0') throw new Error('Invalid pool state')
  const center = Math.floor(Math.floor(tick / pool.tickSpacing) / 256)
  const minWord = Math.floor(Math.ceil(-887272 / pool.tickSpacing) / 256)
  const maxWord = Math.floor(Math.floor(887272 / pool.tickSpacing) / 256)
  const firstWord = coverage
    ? Math.floor(coverage.tickLower / pool.tickSpacing / 256)
    : Math.max(minWord, center - wordRadius)
  const lastWord = coverage
    ? Math.floor(coverage.tickUpper / pool.tickSpacing / 256)
    : Math.min(maxWord, center + wordRadius)
  if (lastWord - firstWord > 8) throw new Error('Tick bitmap word limit exceeded')
  const wordPositions = Array.from({ length: lastWord - firstWord + 1 }, (_, index) => firstWord + index)
  const bitmaps = await rpc.many(
    wordPositions.map((position) => callAt(block, POOL_ADDRESS, SELECTORS.tickBitmap + argument(position))),
  )
  const indexes = bitmaps.flatMap((bitmap, index) => bitmapTicks(bitmap, wordPositions[index], pool.tickSpacing))
  if (indexes.length > MAX_TICKS) throw new Error('Initialized tick limit exceeded')
  const tickRaw = await rpc.many(indexes.map((index) => callAt(block, POOL_ADDRESS, SELECTORS.ticks + argument(index))))
  const ticks = tickRaw.map((value, index) => {
    const record = words(value, 8)
    const liquidityGross = uint(record[0], 128)
    const liquidityNet = int(record[1], 128)
    if (
      uint(record[7], 8) !== 1n ||
      liquidityGross === 0n ||
      liquidityNet > liquidityGross ||
      -liquidityNet > liquidityGross
    ) {
      throw new Error('Tick bitmap and initialized tick state disagree')
    }
    return { tick: indexes[index], liquidityGross: liquidityGross.toString(), liquidityNet: liquidityNet.toString() }
  })
  return {
    block,
    sqrtPriceX96,
    tick,
    liquidity,
    ticks,
    coverage: coverage ?? {
      tickLower: Math.max(Math.ceil(-887272 / pool.tickSpacing) * pool.tickSpacing, firstWord * 256 * pool.tickSpacing),
      tickUpper: Math.min(
        Math.floor(887272 / pool.tickSpacing) * pool.tickSpacing,
        ((lastWord + 1) * 256 - 1) * pool.tickSpacing,
      ),
    },
  }
}

async function readLogs(rpc, from, to) {
  try {
    const result = await rpc.call('eth_getLogs', [
      {
        address: POOL_ADDRESS,
        fromBlock: quantity(from),
        toBlock: quantity(to),
        topics: [Object.values(POOL_EVENT_TOPICS)],
      },
    ])
    if (!Array.isArray(result)) throw new Error('RPC logs response is not an array')
    if (result.length >= 10000)
      throw Object.assign(new Error('RPC log response requires smaller range'), { code: -32005 })
    return result
  } catch (error) {
    if (from === to || ![-32000, -32005, -32602].includes(error.code)) throw error
    const middle = Math.floor((from + to) / 2)
    return [...(await readLogs(rpc, from, middle)), ...(await readLogs(rpc, middle + 1, to))]
  }
}
