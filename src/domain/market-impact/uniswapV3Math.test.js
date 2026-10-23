import { describe, expect, it } from 'vitest'
import {
  Q96,
  MIN_TICK,
  MAX_TICK,
  MIN_SQRT_RATIO,
  MAX_SQRT_RATIO,
  MAX_UINT128,
  MAX_UINT160,
  MAX_UINT256,
  getSqrtRatioAtTick,
  getTickAtSqrtRatio,
  getAmount0Delta,
  getAmount1Delta,
  getNextSqrtPriceFromInput,
  computeSwapStepExactInput,
} from './uniswapV3Math.js'

// Expected literals from Uniswap/v3-core test/{TickMath,SqrtPriceMath,SwapMath}.spec.ts.
// https://github.com/Uniswap/v3-core/tree/main/test
const UNIT = 10n ** 18n

describe('Uniswap v3 TickMath protocol vectors', () => {
  it.each([
    [MIN_TICK, '4295128739'],
    [MIN_TICK + 1, '4295343490'],
    [0, '79228162514264337593543950336'],
    [MAX_TICK - 1, '1461373636630004318706518188784493106690254656249'],
    [MAX_TICK, '1461446703485210103287273052203988822378723970342'],
  ])('tick %s matches the protocol integer vector', (tick, expected) => {
    expect(getSqrtRatioAtTick(tick)).toBe(BigInt(expected))
  })
  it('enforces the protocol half-open inverse price domain', () => {
    expect(getTickAtSqrtRatio(MIN_SQRT_RATIO)).toBe(MIN_TICK)
    expect(getTickAtSqrtRatio(MAX_SQRT_RATIO - 1n)).toBe(MAX_TICK - 1)
    expect(() => getTickAtSqrtRatio(MAX_SQRT_RATIO)).toThrow()
    expect(() => getTickAtSqrtRatio(MIN_SQRT_RATIO - 1n)).toThrow()
    expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow()
    expect(() => getSqrtRatioAtTick(0.1)).toThrow()
  })
  it('returns the greatest tick throughout the domain including neighboring wei', () => {
    for (const tick of [-887271, -738203, -100000, -61, -1, 0, 1, 60, 100000, 738203, 887270]) {
      const sqrt = getSqrtRatioAtTick(tick)
      expect(getTickAtSqrtRatio(sqrt)).toBe(tick)
      expect(getTickAtSqrtRatio(sqrt - 1n)).toBe(tick - 1)
      expect(getTickAtSqrtRatio(sqrt + 1n)).toBe(tick)
    }
  })
})

describe('Uniswap v3 SqrtPriceMath protocol vectors', () => {
  it('keeps opposite directional rounding for input token0 / token1', () => {
    expect(getNextSqrtPriceFromInput(Q96, UNIT, UNIT / 10n, false)).toBe(87150978765690771352898345369n)
    expect(getNextSqrtPriceFromInput(Q96, UNIT, UNIT / 10n, true)).toBe(72025602285694852357767227579n)
    expect(getNextSqrtPriceFromInput(Q96, 10n * UNIT, 1n << 100n, true)).toBe(624999999995069620n)
  })
  it('retains the Solidity uint256 overflow fallback and rejects price overflow', () => {
    const amount = MAX_UINT256 - (MAX_UINT128 << 96n) / MAX_UINT160
    expect(getNextSqrtPriceFromInput(MAX_UINT160, MAX_UINT128, amount, true)).toBe(1n)
    expect(() => getNextSqrtPriceFromInput(MAX_UINT160, 1024n, 1024n, false)).toThrow()
    expect(() => getNextSqrtPriceFromInput(Q96, 0n, 1n, true)).toThrow()
  })
  it('matches a large numerator protocol regression with exact amount conservation', () => {
    const start = 1025574284609383690408304870162715216695788925244n
    const liquidity = 50015962439936049619261659728067971248n
    const end = getNextSqrtPriceFromInput(start, liquidity, 406n, true)
    expect(end).toBe(1025574284609383582644711336373707553698163132913n)
    expect(getAmount0Delta(end, start, liquidity, true)).toBe(406n)
  })
  it('matches the 1 to 1.21 price inventory vector and one-wei rounding bounds', () => {
    const sqrt121 = (Q96 * 11n) / 10n
    expect(getAmount0Delta(Q96, sqrt121, UNIT, true)).toBe(90909090909090910n)
    expect(getAmount0Delta(Q96, sqrt121, UNIT, false)).toBe(90909090909090909n)
    expect(getAmount1Delta(Q96, sqrt121, UNIT, true)).toBe(100000000000000000n)
    expect(getAmount1Delta(Q96, sqrt121, UNIT, false)).toBe(99999999999999999n)
  })
})

describe('Uniswap v3 exact-input SwapMath vectors', () => {
  it('spends the specified input and exact protocol fee before reaching the target', () => {
    const step = computeSwapStepExactInput(Q96, Q96 * 3n, UNIT * 2n, UNIT, 600)
    expect(step.amountIn).toBe(999400000000000000n)
    expect(step.feeAmount).toBe(600000000000000n)
    expect(step.amountOut).toBe(666399946655997866n)
    expect(step.sqrtPriceX96).toBe(Q96 + (999400000000000000n * Q96) / (UNIT * 2n))
  })
  it('caps at a target and leaves unused input, with the official sqrt(1.01) vector', () => {
    const target = 79623317895830914510639640423n
    const step = computeSwapStepExactInput(Q96, target, UNIT * 2n, UNIT, 600)
    expect(step).toEqual({
      sqrtPriceX96: target,
      amountIn: 9975124224178055n,
      amountOut: 9925619580021728n,
      feeAmount: 5988667735148n,
    })
  })
  it('can consume all input as fees without price movement or output', () => {
    expect(computeSwapStepExactInput(2413n, 79887613182836312n, 1985041575832132834610021537970n, 10n, 1872)).toEqual({
      sqrtPriceX96: 2413n,
      amountIn: 0n,
      amountOut: 0n,
      feeAmount: 10n,
    })
  })
  it('traverses a zero-liquidity interval without charging tokens or fees', () => {
    expect(computeSwapStepExactInput(Q96, Q96 * 2n, 0n, UNIT, 3000)).toEqual({
      sqrtPriceX96: Q96 * 2n,
      amountIn: 0n,
      amountOut: 0n,
      feeAmount: 0n,
    })
  })
})
