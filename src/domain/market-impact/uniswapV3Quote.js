// SPDX-License-Identifier: GPL-2.0-or-later
// Swap traversal follows Uniswap v3-core UniswapV3Pool.sol / TickBitmap.sol.
// Copyright (c) 2021 Uniswap Labs. Modified 2026 for bounded snapshot research.
// Raw quantities use BigInt; Number conversions below are display-only.
import {
  MAX_SQRT_RATIO,
  MIN_SQRT_RATIO,
  MIN_TICK,
  MAX_TICK,
  MAX_UINT128,
  Q96,
  computeSwapStepExactInput,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
} from './uniswapV3Math.js'

const MAX_INT256 = (1n << 255n) - 1n
const MAX_INT128 = (1n << 127n) - 1n
const MAX_STEPS = 100000

/**
 * Exact-input quote conditional on complete initialized ticks inside coverage.
 * Stops at either known coverage edge; never extrapolates liquidity outside it.
 * Includes pool fees in consumed input / average price, excludes gas and routing.
 * Impacts are signed quote/base price changes; they are not trade instructions.
 */
export function quoteExactInput({ pool, state, tokenIn, amountInRaw, maxSteps = 4096 } = {}) {
  try {
    const context = validate({ pool, state, tokenIn, amountInRaw, maxSteps })
    const result = traverse(context)
    return formatResult(context, result)
  } catch (error) {
    return invalidResult(error instanceof Error ? error.message : 'invalid-input')
  }
}

function validate({ pool, state, tokenIn, amountInRaw, maxSteps }) {
  if (tokenIn !== 0 && tokenIn !== 1) throw new TypeError('invalid-token-in')
  if (pool?.baseTokenIndex !== 0 && pool?.baseTokenIndex !== 1) throw new TypeError('invalid-base-token-index')
  for (const token of [pool?.token0, pool?.token1]) {
    if (!Number.isInteger(token?.decimals) || token.decimals < 0 || token.decimals > 255)
      throw new TypeError('invalid-token-decimals')
  }
  if (!Number.isInteger(pool.feePips) || pool.feePips < 0 || pool.feePips >= 1000000) throw new TypeError('invalid-fee')
  if (!Number.isInteger(pool.tickSpacing) || pool.tickSpacing < 1 || pool.tickSpacing >= 16384)
    throw new TypeError('invalid-tick-spacing')
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) throw new TypeError('invalid-max-steps')
  const amount = rawInteger(amountInRaw, MAX_INT256, 'amount-in')
  const sqrt = rawInteger(state?.sqrtPriceX96, MAX_SQRT_RATIO - 1n, 'sqrt-price')
  const actualTick = getTickAtSqrtRatio(sqrt)
  const tick = state?.tick
  const exactBoundary = sqrt === getSqrtRatioAtTick(actualTick)
  if (!Number.isInteger(tick) || (tick !== actualTick && !(exactBoundary && tick === actualTick - 1)))
    throw new TypeError('inconsistent-tick-price')
  const liquidity = rawInteger(state?.liquidity, MAX_UINT128, 'liquidity')
  const lower = state?.coverage?.tickLower
  const upper = state?.coverage?.tickUpper
  if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower < MIN_TICK || upper > MAX_TICK || lower >= upper)
    throw new TypeError('invalid-coverage')
  const lowerSqrt = getSqrtRatioAtTick(lower)
  const upperSqrt = getSqrtRatioAtTick(upper)
  if (sqrt < lowerSqrt || sqrt > upperSqrt) throw new TypeError('price-outside-coverage')
  if (!Array.isArray(state.ticks)) throw new TypeError('missing-initialized-ticks')
  const ticks = new Map()
  for (const record of state.ticks) {
    const index = record?.tick
    if (!Number.isInteger(index) || index < lower || index > upper || index % pool.tickSpacing !== 0)
      throw new TypeError('invalid-initialized-tick')
    if (ticks.has(index)) throw new TypeError('duplicate-initialized-tick')
    const gross = rawInteger(record.liquidityGross, MAX_UINT128, 'liquidity-gross')
    const net = rawSigned(record.liquidityNet)
    if (gross === 0n || net > gross || -net > gross) throw new TypeError('inconsistent-tick-liquidity')
    ticks.set(index, net)
  }
  return {
    pool,
    tokenIn,
    amount,
    sqrt,
    tick,
    liquidity,
    ticks,
    maxSteps,
    tickIndexes: [...ticks.keys()].sort((left, right) => left - right),
    lower: lowerSqrt > MIN_SQRT_RATIO ? lowerSqrt : MIN_SQRT_RATIO + 1n,
    upper: upperSqrt < MAX_SQRT_RATIO ? upperSqrt : MAX_SQRT_RATIO - 1n,
  }
}

function traverse(context) {
  const zeroForOne = context.tokenIn === 0
  const limit = zeroForOne ? context.lower : context.upper
  let sqrt = context.sqrt
  let tick = context.tick
  let liquidity = context.liquidity
  let remaining = context.amount
  let amountOut = 0n
  let feeAmount = 0n
  let steps = 0
  let reason = null
  while (remaining > 0n) {
    if (zeroForOne ? sqrt <= limit : sqrt >= limit) {
      reason = 'coverage-exhausted'
      break
    }
    if (steps >= context.maxSteps) {
      reason = 'step-limit'
      break
    }
    const nextTick = nextTickWithinWord(tick, context.pool.tickSpacing, zeroForOne, context.tickIndexes)
    const nextSqrt = getSqrtRatioAtTick(nextTick)
    const target = zeroForOne ? (nextSqrt < limit ? limit : nextSqrt) : nextSqrt > limit ? limit : nextSqrt
    const step = computeSwapStepExactInput(sqrt, target, liquidity, remaining, context.pool.feePips)
    const spent = step.amountIn + step.feeAmount
    if (spent > remaining) throw new RangeError('input-conservation-failure')
    remaining -= spent
    amountOut += step.amountOut
    feeAmount += step.feeAmount
    const previousSqrt = sqrt
    sqrt = step.sqrtPriceX96
    if (sqrt === nextSqrt) {
      const net = context.ticks.get(nextTick) ?? 0n
      liquidity += zeroForOne ? -net : net
      if (liquidity < 0n || liquidity > MAX_UINT128) throw new RangeError('invalid-crossed-liquidity')
      tick = zeroForOne ? nextTick - 1 : nextTick
    } else if (sqrt !== previousSqrt) {
      tick = getTickAtSqrtRatio(sqrt)
    }
    steps += 1
  }
  return { sqrt, tick, liquidity, remaining, amountOut, feeAmount, steps, reason }
}

// Preserve uninitialized 256-bit word boundaries as the contract does. Skipping
// those steps changes integer rounding / fees even when active L is unchanged.
function nextTickWithinWord(tick, spacing, zeroForOne, tickIndexes) {
  const compressed = Math.floor(tick / spacing)
  const wordStart = Math.floor((zeroForOne ? compressed : compressed + 1) / 256) * 256
  let candidate = (zeroForOne ? wordStart : wordStart + 255) * spacing
  let low = 0
  let high = tickIndexes.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (tickIndexes[middle] <= tick) low = middle + 1
    else high = middle
  }
  const initialized = tickIndexes[zeroForOne ? low - 1 : low]
  if (zeroForOne && initialized >= candidate) candidate = initialized
  if (!zeroForOne && initialized <= candidate) candidate = initialized
  return Math.max(MIN_TICK, Math.min(MAX_TICK, candidate))
}

function formatResult(context, result) {
  const consumed = context.amount - result.remaining
  const priceBefore = quotePrice(context.sqrt, context.pool)
  const priceAfter = quotePrice(result.sqrt, context.pool)
  const baseIn = context.tokenIn === context.pool.baseTokenIndex
  const baseRaw = baseIn ? consumed : result.amountOut
  const quoteRaw = baseIn ? result.amountOut : consumed
  const baseDecimals = context.pool[`token${context.pool.baseTokenIndex}`].decimals
  const quoteDecimals = context.pool[`token${1 - context.pool.baseTokenIndex}`].decimals
  const average =
    baseRaw > 0n && quoteRaw > 0n ? (Number(quoteRaw) / Number(baseRaw)) * 10 ** (baseDecimals - quoteDecimals) : null
  const averageExecutionPrice = finitePositive(average)
  // Use sqrt ratios for marginal bps so token decimals cannot lose precision.
  const rawRatio = Number(result.sqrt) / Number(context.sqrt)
  const relativePrice = context.pool.baseTokenIndex === 0 ? rawRatio ** 2 : 1 / rawRatio ** 2
  return {
    status: result.remaining === 0n ? 'complete' : 'partial',
    reason: result.reason,
    amountInConsumedRaw: consumed.toString(),
    amountOutRaw: result.amountOut.toString(),
    unfilledAmountInRaw: result.remaining.toString(),
    feeAmountRaw: result.feeAmount.toString(),
    sqrtPriceX96After: result.sqrt.toString(),
    tickAfter: result.tick,
    liquidityAfter: result.liquidity.toString(),
    priceBefore,
    priceAfter,
    averageExecutionPrice,
    marginalImpactBps: Number.isFinite(relativePrice) ? (relativePrice - 1) * 10000 : null,
    executionImpactBps: signedImpact(averageExecutionPrice, priceBefore),
    steps: result.steps,
    priceUnit: 'quote/base',
    impactSemantics: 'signed-quote-per-base-change-includes-pool-fees-excludes-gas',
    executionAuthority: 'none',
  }
}

function quotePrice(sqrt, pool) {
  const ratio = Number(sqrt) / Number(Q96)
  const token1PerToken0 = ratio ** 2 * 10 ** (pool.token0.decimals - pool.token1.decimals)
  return finitePositive(pool.baseTokenIndex === 0 ? token1PerToken0 : 1 / token1PerToken0)
}

function signedImpact(after, before) {
  if (after === null || before === null) return null
  const bps = (after / before - 1) * 10000
  return Number.isFinite(bps) ? bps : null
}

function finitePositive(value) {
  return Number.isFinite(value) && value > 0 ? value : null
}

function rawInteger(value, maximum, name) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new TypeError(`invalid-${name}`)
  const parsed = BigInt(value)
  if (parsed > maximum) throw new RangeError(`invalid-${name}`)
  return parsed
}

function rawSigned(value) {
  if (typeof value !== 'string' || !/^(0|-?[1-9]\d*)$/.test(value)) throw new TypeError('invalid-liquidity-net')
  const parsed = BigInt(value)
  if (parsed < -MAX_INT128 - 1n || parsed > MAX_INT128) throw new RangeError('invalid-liquidity-net')
  return parsed
}

function invalidResult(reason) {
  return {
    status: 'invalid',
    reason,
    amountInConsumedRaw: null,
    amountOutRaw: null,
    unfilledAmountInRaw: null,
    feeAmountRaw: null,
    sqrtPriceX96After: null,
    tickAfter: null,
    liquidityAfter: null,
    priceBefore: null,
    priceAfter: null,
    averageExecutionPrice: null,
    marginalImpactBps: null,
    executionImpactBps: null,
    executionAuthority: 'none',
  }
}
