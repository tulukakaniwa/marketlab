// SPDX-License-Identifier: GPL-2.0-or-later
// Adapted from Uniswap/v3-core TickMath, SqrtPriceMath and SwapMath.
// Copyright (c) 2021 Uniswap Labs. Modified 2026: JavaScript BigInt, exact-input only.
// https://github.com/Uniswap/v3-core/tree/main/contracts/libraries
// SqrtPriceMath/SwapMath were BUSL-1.1; the upstream LICENSE changes to GPL-2.0-or-later on 2023-04-01.
// This port preserves protocol integer rounding and uint256 overflow fallback.

export const Q96 = 1n << 96n
export const MIN_TICK = -887272
export const MAX_TICK = 887272
export const MIN_SQRT_RATIO = 4295128739n
export const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n
export const MAX_UINT128 = (1n << 128n) - 1n
export const MAX_UINT160 = (1n << 160n) - 1n
export const MAX_UINT256 = (1n << 256n) - 1n
const FEE_DENOMINATOR = 1000000n
const TICK_FACTORS = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
]

export function getSqrtRatioAtTick(tick) {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) throw new RangeError('invalid-tick')
  const absolute = Math.abs(tick)
  let ratio = 1n << 128n
  for (let bit = 0; bit < TICK_FACTORS.length; bit += 1) {
    if ((absolute & (1 << bit)) !== 0) ratio = (ratio * TICK_FACTORS[bit]) >> 128n
  }
  if (tick > 0) ratio = MAX_UINT256 / ratio
  return (ratio >> 32n) + (ratio % (1n << 32n) === 0n ? 0n : 1n)
}

// Binary search has the same greatest-tick contract as TickMath's assembly log.
// Its bounded 21 iterations avoid floating-point logarithms entirely.
export function getTickAtSqrtRatio(sqrtPriceX96) {
  if (typeof sqrtPriceX96 !== 'bigint' || sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO)
    throw new RangeError('invalid-sqrt-ratio')
  let low = MIN_TICK
  let high = MAX_TICK - 1
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    if (getSqrtRatioAtTick(middle) <= sqrtPriceX96) low = middle
    else high = middle - 1
  }
  return low
}

export function divRoundingUp(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) throw new RangeError('invalid-division')
  return numerator / denominator + (numerator % denominator === 0n ? 0n : 1n)
}

export function getAmount0Delta(sqrtA, sqrtB, liquidity, roundUp = false) {
  validateSqrtAndLiquidity(sqrtA, liquidity)
  unsigned(sqrtB, MAX_UINT160, 'sqrt-price')
  if (sqrtB === 0n) throw new RangeError('invalid-sqrt-price')
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]
  const numerator = (liquidity << 96n) * (sqrtB - sqrtA)
  return roundUp ? divRoundingUp(divRoundingUp(numerator, sqrtB), sqrtA) : numerator / sqrtB / sqrtA
}

export function getAmount1Delta(sqrtA, sqrtB, liquidity, roundUp = false) {
  validateSqrtAndLiquidity(sqrtA, liquidity)
  unsigned(sqrtB, MAX_UINT160, 'sqrt-price')
  if (sqrtB === 0n) throw new RangeError('invalid-sqrt-price')
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA]
  const numerator = liquidity * (sqrtB - sqrtA)
  return roundUp ? divRoundingUp(numerator, Q96) : numerator / Q96
}

export function getNextSqrtPriceFromInput(sqrtPriceX96, liquidity, amountIn, zeroForOne) {
  validateSqrtAndLiquidity(sqrtPriceX96, liquidity)
  unsigned(amountIn, MAX_UINT256, 'amount-in')
  if (liquidity === 0n) throw new RangeError('zero-liquidity')
  if (typeof zeroForOne !== 'boolean') throw new TypeError('invalid-direction')
  if (amountIn === 0n) return sqrtPriceX96
  let next
  if (zeroForOne) {
    const numerator = liquidity << 96n
    const product = amountIn * sqrtPriceX96
    const denominator = numerator + product
    if (product <= MAX_UINT256 && denominator <= MAX_UINT256) {
      next = divRoundingUp(numerator * sqrtPriceX96, denominator)
    } else {
      const fallbackDenominator = numerator / sqrtPriceX96 + amountIn
      unsigned(fallbackDenominator, MAX_UINT256, 'denominator')
      next = divRoundingUp(numerator, fallbackDenominator)
    }
  } else {
    next = sqrtPriceX96 + (amountIn * Q96) / liquidity
  }
  unsigned(next, MAX_UINT160, 'next-sqrt-price')
  return next
}

export function computeSwapStepExactInput(sqrtCurrent, sqrtTarget, liquidity, amountRemaining, feePips) {
  validateSqrtAndLiquidity(sqrtCurrent, liquidity)
  unsigned(sqrtTarget, MAX_UINT160, 'sqrt-target')
  if (sqrtTarget === 0n) throw new RangeError('invalid-sqrt-target')
  unsigned(amountRemaining, (1n << 255n) - 1n, 'amount-remaining')
  if (!Number.isInteger(feePips) || feePips < 0 || feePips >= 1000000) throw new RangeError('invalid-fee')
  const fee = BigInt(feePips)
  const zeroForOne = sqrtCurrent >= sqrtTarget
  const available = (amountRemaining * (FEE_DENOMINATOR - fee)) / FEE_DENOMINATOR
  let amountIn = zeroForOne
    ? getAmount0Delta(sqrtTarget, sqrtCurrent, liquidity, true)
    : getAmount1Delta(sqrtCurrent, sqrtTarget, liquidity, true)
  const sqrtPriceX96 =
    available >= amountIn ? sqrtTarget : getNextSqrtPriceFromInput(sqrtCurrent, liquidity, available, zeroForOne)
  const reachedTarget = sqrtPriceX96 === sqrtTarget
  if (!reachedTarget) {
    amountIn = zeroForOne
      ? getAmount0Delta(sqrtPriceX96, sqrtCurrent, liquidity, true)
      : getAmount1Delta(sqrtCurrent, sqrtPriceX96, liquidity, true)
  }
  const amountOut = zeroForOne
    ? getAmount1Delta(sqrtPriceX96, sqrtCurrent, liquidity, false)
    : getAmount0Delta(sqrtCurrent, sqrtPriceX96, liquidity, false)
  const feeAmount = reachedTarget ? divRoundingUp(amountIn * fee, FEE_DENOMINATOR - fee) : amountRemaining - amountIn
  return { sqrtPriceX96, amountIn, amountOut, feeAmount }
}

function validateSqrtAndLiquidity(sqrtPriceX96, liquidity) {
  unsigned(sqrtPriceX96, MAX_UINT160, 'sqrt-price')
  if (sqrtPriceX96 === 0n) throw new RangeError('invalid-sqrt-price')
  unsigned(liquidity, MAX_UINT128, 'liquidity')
}

function unsigned(value, maximum, name) {
  if (typeof value !== 'bigint' || value < 0n || value > maximum) throw new RangeError(`invalid-${name}`)
}
