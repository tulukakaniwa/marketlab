import {
  checkCoveragePrice,
  checkLiquidity,
  checkPriceTick,
  checkTickLiquidity,
  MAX_CAPTURED_CELLS,
  MAX_EVENTS,
  MAX_TICKS,
  rawInteger,
  validateReplayBundle,
} from './uniswapV3ReplayEvidence.js'
import { getSqrtRatioAtTick } from './uniswapV3Math.js'

function snapshotOf(state, cursor) {
  return {
    block: { ...state.block },
    sqrtPriceX96: state.sqrtPriceX96.toString(),
    tick: state.tick,
    liquidity: state.liquidity.toString(),
    ticks: [...state.ticks.values()]
      .sort((a, b) => a.tick - b.tick)
      .map(({ tick, gross, net }) => ({ tick, liquidityGross: gross.toString(), liquidityNet: net.toString() })),
    coverage: { ...state.coverage },
    cursor: { ...cursor },
  }
}

function logCursor(event, kind) {
  return { kind, blockNumber: event.blockNumber, transactionIndex: event.transactionIndex, logIndex: event.logIndex }
}

function stateFromSeed(seed) {
  return {
    block: { ...seed.block },
    sqrtPriceX96: rawInteger(seed.sqrtPriceX96),
    tick: seed.tick,
    liquidity: rawInteger(seed.liquidity),
    ticks: new Map(
      seed.ticks.map((item) => [
        item.tick,
        {
          tick: item.tick,
          gross: rawInteger(item.liquidityGross),
          net: rawInteger(item.liquidityNet, true),
        },
      ]),
    ),
    coverage: { ...seed.coverage },
  }
}

function applyLiquidityEvent(state, event, tickSpacing) {
  const delta = rawInteger(event.liquidityDeltaRaw, true)
  if (
    (event.type === 'Mint' && delta <= 0n) ||
    (event.type === 'Burn' && delta > 0n) ||
    delta >= 1n << 127n ||
    delta <= -(1n << 127n)
  ) {
    throw new Error('invalid-liquidity-event-delta')
  }
  const changes = []
  for (const [tick, sign] of [
    [event.tickLower, 1n],
    [event.tickUpper, -1n],
  ]) {
    if (tick < state.coverage.tickLower || tick > state.coverage.tickUpper) continue
    const old = state.ticks.get(tick) || { tick, gross: 0n, net: 0n }
    const updated = { tick, gross: old.gross + delta, net: old.net + sign * delta }
    checkTickLiquidity(updated.gross, updated.net, tickSpacing)
    changes.push(updated)
  }
  const activeDelta = event.tickLower <= state.tick && state.tick < event.tickUpper ? delta : 0n
  const nextLiquidity = state.liquidity + activeDelta
  checkLiquidity(nextLiquidity)
  for (const change of changes) {
    if (change.gross === 0n) state.ticks.delete(change.tick)
    else state.ticks.set(change.tick, change)
  }
  if (state.ticks.size > MAX_TICKS) throw new Error('replay-tick-limit')
  state.liquidity = nextLiquidity
}

function applySwap(state, event) {
  const sqrt = checkPriceTick(event.sqrtPriceX96, event.tick)
  const amount0 = rawInteger(event.amount0Raw, true)
  const amount1 = rawInteger(event.amount1Raw, true)
  const down = sqrt < state.sqrtPriceX96 || (sqrt === state.sqrtPriceX96 && event.tick < state.tick)
  const up = sqrt > state.sqrtPriceX96 || (sqrt === state.sqrtPriceX96 && event.tick > state.tick)
  const zeroAmounts = amount0 === 0n && amount1 === 0n
  if (zeroAmounts) {
    if (sqrt === state.sqrtPriceX96) throw new Error('invalid-zero-amount-swap')
  } else if (!((amount0 > 0n && amount1 <= 0n && !up) || (amount1 > 0n && amount0 <= 0n && !down))) {
    throw new Error('swap-direction-amount-mismatch')
  }
  checkCoveragePrice(sqrt, state.coverage)
  let liquidity = state.liquidity
  let cursorSqrt = state.sqrtPriceX96
  const crossed = [...state.ticks.values()]
    .filter(({ tick }) => (down ? tick <= state.tick && tick > event.tick : tick > state.tick && tick <= event.tick))
    .sort((a, b) => (down ? b.tick - a.tick : a.tick - b.tick))
  for (const item of crossed) {
    const boundarySqrt = getSqrtRatioAtTick(item.tick)
    if (zeroAmounts && liquidity !== 0n && boundarySqrt !== cursorSqrt)
      throw new Error('zero-amount-through-positive-liquidity')
    liquidity += down ? -item.net : item.net
    checkLiquidity(liquidity)
    cursorSqrt = boundarySqrt
  }
  if (zeroAmounts && liquidity !== 0n && sqrt !== cursorSqrt) throw new Error('zero-amount-through-positive-liquidity')
  if (liquidity !== rawInteger(event.liquidity)) throw new Error('swap-active-liquidity-mismatch')
  // The event is an observed endpoint, never a pre-trade quote or inferred input.
  state.sqrtPriceX96 = sqrt
  state.tick = event.tick
  state.liquidity = liquidity
}

function checkpointMatches(state, checkpoint) {
  if (
    state.sqrtPriceX96 !== checkpoint.sqrtPriceX96 ||
    state.tick !== checkpoint.tick ||
    state.liquidity !== checkpoint.liquidity
  ) {
    return false
  }
  return (
    state.ticks.length === checkpoint.ticks.length &&
    state.ticks.every((tick, index) => {
      const expected = checkpoint.ticks[index]
      return (
        tick.tick === expected.tick &&
        tick.liquidityGross === expected.liquidityGross &&
        tick.liquidityNet === expected.liquidityNet
      )
    })
  )
}

function resultBase(bundle) {
  return {
    executionAuthority: 'none',
    stepsScope: 'liquidity-actions',
    availableAt: bundle?.provenance?.availableAt ?? null,
    evidenceScope: 'provided-canonical-headers-logs-and-checkpoint',
    eventCounts: { Mint: 0, Burn: 0, Swap: 0, Collect: 0 },
  }
}

/**
 * Reconstruct a bounded historical pool state, then compare the independent endpoint.
 * `verified` means consistency of the supplied evidence, not RPC/canonicality attestation.
 * Steps retain only Mint/Burn actions; all events are validated and applied in order.
 * availableAt describes when this captured bundle became available, not its event times.
 */
export function replayPoolEvents(bundle, { maxEvents = MAX_EVENTS, includeSteps = true } = {}) {
  const base = resultBase(bundle)
  const evidence = validateReplayBundle(bundle, maxEvents)
  if (evidence.issues.length) return { ...base, status: 'blocked', issues: evidence.issues, state: null, steps: [] }
  const state = stateFromSeed(bundle.seed)
  const steps = []
  let capturedCells = 0
  try {
    for (const event of bundle.events) {
      state.block = { ...evidence.headers.get(event.blockNumber) }
      const capture = includeSteps && (event.type === 'Mint' || event.type === 'Burn')
      // Two snapshots plus scalar overhead, bounded before allocating either copy.
      if (capture && capturedCells + state.ticks.size * 2 + 10 > MAX_CAPTURED_CELLS)
        throw new Error('replay-capture-memory-limit')
      const before = capture ? snapshotOf(state, logCursor(event, 'before-log')) : null
      if (event.type === 'Mint' || event.type === 'Burn') applyLiquidityEvent(state, event, bundle.pool.tickSpacing)
      else if (event.type === 'Swap') applySwap(state, event)
      // Collect transfers already owed tokens; it changes neither active L nor price.
      base.eventCounts[event.type]++
      if (capture) {
        const after = snapshotOf(state, logCursor(event, 'after-log'))
        capturedCells += before.ticks.length + after.ticks.length + 8
        steps.push({ event: { ...event }, before, after })
      }
    }
    state.block = { ...evidence.headers.get(bundle.scan.toBlock) }
    const finalState = snapshotOf(state, { kind: 'end-of-block', blockNumber: bundle.scan.toBlock })
    if (!checkpointMatches(finalState, bundle.checkpoint)) throw new Error('endpoint-checkpoint-mismatch')
    return { ...base, status: 'verified', issues: [], state: finalState, steps }
  } catch (error) {
    return {
      ...base,
      status: 'blocked',
      issues: [error instanceof Error ? error.message : 'replay-failed'],
      state: null,
      steps: [],
    }
  }
}
