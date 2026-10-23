import { getSqrtRatioAtTick, getTickAtSqrtRatio } from './uniswapV3Math.js'
import { decodePoolLog, eventMatchesLog, eventTimeSeconds, isAddress, isHash } from './uniswapV3EventEvidence.js'

export const MAX_EVENTS = 100000
export const MAX_TICKS = 20000
export const MAX_CAPTURED_CELLS = 1000000
export const MAX_UINT128 = (1n << 128n) - 1n
const MIN_TICK = -887272
const MAX_TICK = 887272
const TOKENS = [
  { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', decimals: 6 },
  { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', decimals: 18 },
]

export function rawInteger(value, signed = false) {
  const pattern = signed ? /^(0|-?[1-9]\d*)$/ : /^(0|[1-9]\d*)$/
  if (typeof value !== 'string' || value.length > 79 || !pattern.test(value)) throw new Error('invalid-raw-integer')
  return BigInt(value)
}

export function validTick(value) {
  return Number.isSafeInteger(value) && value >= MIN_TICK && value <= MAX_TICK
}

export function checkPriceTick(sqrtPriceX96, tick) {
  const sqrt = rawInteger(sqrtPriceX96)
  if (!validTick(tick)) throw new Error('invalid-current-tick')
  const calculated = getTickAtSqrtRatio(sqrt)
  // At a downward crossing slot0.tick is boundary - 1, even at an exact boundary.
  if (tick !== calculated && !(tick === calculated - 1 && sqrt === getSqrtRatioAtTick(calculated))) {
    throw new Error('sqrt-price-tick-mismatch')
  }
  return sqrt
}

export function checkCoveragePrice(sqrt, coverage) {
  if (sqrt < getSqrtRatioAtTick(coverage.tickLower) || sqrt > getSqrtRatioAtTick(coverage.tickUpper)) {
    throw new Error('price-outside-tick-coverage')
  }
}

export function maxGrossLiquidity(tickSpacing) {
  const lower = Math.trunc(MIN_TICK / tickSpacing) * tickSpacing
  const upper = Math.trunc(MAX_TICK / tickSpacing) * tickSpacing
  return MAX_UINT128 / BigInt((upper - lower) / tickSpacing + 1)
}

export function checkLiquidity(value) {
  if (value < 0n || value > MAX_UINT128) throw new Error('active-liquidity-out-of-range')
}

export function checkTickLiquidity(gross, net, tickSpacing) {
  if (gross < 0n || gross > maxGrossLiquidity(tickSpacing)) throw new Error('gross-liquidity-out-of-range')
  if (net < -(1n << 127n) || net >= 1n << 127n || net > gross || -net > gross) {
    throw new Error('net-liquidity-out-of-range')
  }
  if ((gross + net) % 2n !== 0n) throw new Error('gross-net-parity-mismatch')
}

function validatePool(pool) {
  if (
    !pool ||
    pool.chainId !== 1 ||
    !isAddress(pool.poolAddress) ||
    pool.baseTokenIndex !== 1 ||
    pool.poolAddress.toLowerCase() !== '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640'
  ) {
    throw new Error('unsupported-pool-identity')
  }
  for (const [index, expected] of TOKENS.entries()) {
    const actual = pool[`token${index}`]
    if (
      actual?.address?.toLowerCase() !== expected.address ||
      actual?.symbol !== expected.symbol ||
      actual?.decimals !== expected.decimals
    ) {
      throw new Error('unsupported-token-metadata')
    }
  }
  if (pool.feePips !== 500) {
    throw new Error('invalid-fee-pips')
  }
  if (pool.tickSpacing !== 10) {
    throw new Error('invalid-tick-spacing')
  }
}

function validateBlock(block) {
  if (!block || !Number.isSafeInteger(block.number) || block.number < 0 || !isHash(block.hash)) {
    throw new Error('invalid-block-header')
  }
  if (!Number.isSafeInteger(block.timestamp) || block.timestamp < 0 || block.timestamp > 8640000000000) {
    throw new Error('invalid-block-timestamp')
  }
}

function validateSnapshot(snapshot, pool) {
  if (!snapshot) throw new Error('missing-snapshot')
  validateBlock(snapshot.block)
  const sqrt = checkPriceTick(snapshot.sqrtPriceX96, snapshot.tick)
  checkLiquidity(rawInteger(snapshot.liquidity))
  const coverage = snapshot.coverage
  if (
    !coverage ||
    !validTick(coverage.tickLower) ||
    !validTick(coverage.tickUpper) ||
    coverage.tickLower >= coverage.tickUpper
  ) {
    throw new Error('invalid-tick-coverage')
  }
  checkCoveragePrice(sqrt, coverage)
  if (!Array.isArray(snapshot.ticks) || snapshot.ticks.length > MAX_TICKS) throw new Error('invalid-tick-list')
  let previous = MIN_TICK - 1
  for (const item of snapshot.ticks) {
    if (
      !validTick(item.tick) ||
      item.tick % pool.tickSpacing !== 0 ||
      item.tick <= previous ||
      item.tick < coverage.tickLower ||
      item.tick > coverage.tickUpper
    ) {
      throw new Error('invalid-initialized-tick-order-or-coverage')
    }
    previous = item.tick
    const gross = rawInteger(item.liquidityGross)
    const net = rawInteger(item.liquidityNet, true)
    if (gross === 0n) throw new Error('uninitialized-tick-in-snapshot')
    checkTickLiquidity(gross, net, pool.tickSpacing)
  }
  // Every interval within declared coverage must admit nonnegative active liquidity.
  let left = rawInteger(snapshot.liquidity)
  for (const item of [...snapshot.ticks].reverse()) {
    if (item.tick <= snapshot.tick) {
      left -= rawInteger(item.liquidityNet, true)
      checkLiquidity(left)
    }
  }
  let right = rawInteger(snapshot.liquidity)
  for (const item of snapshot.ticks) {
    if (item.tick > snapshot.tick) {
      right += rawInteger(item.liquidityNet, true)
      checkLiquidity(right)
    }
  }
}

function sameBlock(a, b) {
  return a.number === b.number && a.hash.toLowerCase() === b.hash.toLowerCase() && a.timestamp === b.timestamp
}

function validateHeaders(bundle) {
  const { scan, seed, checkpoint, blocks } = bundle
  if (
    !scan ||
    scan.complete !== true ||
    !Number.isSafeInteger(scan.fromBlock) ||
    !Number.isSafeInteger(scan.toBlock) ||
    scan.fromBlock > scan.toBlock
  ) {
    throw new Error('incomplete-or-invalid-scan')
  }
  if (seed.block.number !== scan.fromBlock - 1 || checkpoint.block.number !== scan.toBlock)
    throw new Error('scan-snapshot-range-mismatch')
  if (
    !Array.isArray(blocks) ||
    blocks.length !== scan.toBlock - seed.block.number + 1 ||
    blocks.length > MAX_EVENTS + 1
  ) {
    throw new Error('incomplete-block-headers')
  }
  const headers = new Map()
  const hashes = new Set()
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    validateBlock(block)
    if (!isHash(block.parentHash) || block.number !== seed.block.number + index)
      throw new Error('noncontiguous-block-headers')
    if (
      index &&
      (block.parentHash.toLowerCase() !== blocks[index - 1].hash.toLowerCase() ||
        block.timestamp <= blocks[index - 1].timestamp)
    ) {
      throw new Error('noncanonical-block-chain')
    }
    if (hashes.has(block.hash.toLowerCase())) throw new Error('duplicate-block-hash')
    hashes.add(block.hash.toLowerCase())
    headers.set(block.number, block)
  }
  if (!sameBlock(seed.block, blocks[0]) || !sameBlock(checkpoint.block, blocks.at(-1)))
    throw new Error('snapshot-header-mismatch')
  return headers
}

function validateProvenance(provenance, checkpoint) {
  if (!provenance || provenance.source !== 'ethereum-json-rpc') throw new Error('missing-rpc-provenance')
  const fetched = Date.parse(provenance.fetchedAt)
  const available = Date.parse(provenance.availableAt)
  if (
    !Number.isFinite(fetched) ||
    !Number.isFinite(available) ||
    fetched < checkpoint.block.timestamp * 1000 ||
    available < fetched
  ) {
    throw new Error('invalid-evidence-availability')
  }
  if (!['finalized', 'safe'].includes(provenance.finality)) throw new Error('unconfirmed-finality')
}

function validateEvents(bundle, headers) {
  const { events, rawLogs, pool, scan } = bundle
  if (!Array.isArray(rawLogs) || rawLogs.length !== events.length) throw new Error('missing-raw-log-evidence')
  let previous = null
  const identities = new Set()
  const transactions = new Map()
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    if (!event || event.blockNumber < scan.fromBlock || event.blockNumber > scan.toBlock)
      throw new Error('event-outside-scan')
    const header = headers.get(event.blockNumber)
    const log = rawLogs[index]
    if (log?.address?.toLowerCase() !== pool.poolAddress.toLowerCase()) throw new Error('log-pool-mismatch')
    const decoded = decodePoolLog(log, header)
    if (!eventMatchesLog(event, decoded) || eventTimeSeconds(event.eventTime) !== header.timestamp)
      throw new Error('decoded-event-evidence-mismatch')
    const identity = `${decoded.blockHash}:${decoded.logIndex}`
    if (identities.has(identity)) throw new Error('duplicate-event')
    identities.add(identity)
    if (
      previous &&
      (event.blockNumber < previous.blockNumber ||
        (event.blockNumber === previous.blockNumber &&
          (event.logIndex <= previous.logIndex || event.transactionIndex < previous.transactionIndex)))
    ) {
      throw new Error('nonchronological-events')
    }
    const txKey = `${event.blockNumber}:${event.transactionIndex}`
    const txHash = event.transactionHash.toLowerCase()
    if (transactions.has(txKey) && transactions.get(txKey) !== txHash)
      throw new Error('transaction-index-hash-mismatch')
    if (transactions.has(txHash) && transactions.get(txHash) !== txKey)
      throw new Error('transaction-hash-index-mismatch')
    transactions.set(txKey, txHash)
    transactions.set(txHash, txKey)
    if (
      event.type !== 'Swap' &&
      (!validTick(event.tickLower) ||
        !validTick(event.tickUpper) ||
        event.tickLower >= event.tickUpper ||
        event.tickLower % pool.tickSpacing !== 0 ||
        event.tickUpper % pool.tickSpacing !== 0)
    ) {
      throw new Error('invalid-event-position-range')
    }
    previous = event
  }
}

export function validateReplayBundle(bundle, maxEvents) {
  try {
    if (!bundle || bundle.schemaVersion !== 1) throw new Error('unsupported-bundle-schema')
    if (!Number.isSafeInteger(maxEvents) || maxEvents < 0 || maxEvents > MAX_EVENTS)
      throw new Error('invalid-replay-event-limit')
    if (!Array.isArray(bundle.events) || bundle.events.length > maxEvents) throw new Error('replay-event-limit')
    validatePool(bundle.pool)
    validateSnapshot(bundle.seed, bundle.pool)
    validateSnapshot(bundle.checkpoint, bundle.pool)
    if (
      bundle.seed.coverage.tickLower !== bundle.checkpoint.coverage.tickLower ||
      bundle.seed.coverage.tickUpper !== bundle.checkpoint.coverage.tickUpper
    ) {
      throw new Error('checkpoint-coverage-mismatch')
    }
    const headers = validateHeaders(bundle)
    validateProvenance(bundle.provenance, bundle.checkpoint)
    validateEvents(bundle, headers)
    return { issues: [], headers }
  } catch (error) {
    return { issues: [error instanceof Error ? error.message : 'invalid-replay-bundle'], headers: null }
  }
}
