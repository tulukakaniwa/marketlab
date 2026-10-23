import { describe, expect, it } from 'vitest'
import { getSqrtRatioAtTick, Q96 } from './uniswapV3Math.js'
import { quoteExactInput } from './uniswapV3Quote.js'

const UNIT = 10n ** 18n
const pool = {
  chainId: 1,
  poolAddress: '0xpool',
  baseTokenIndex: 1,
  feePips: 0,
  tickSpacing: 60,
  token0: { address: '0x0', symbol: 'QUOTE', decimals: 18 },
  token1: { address: '0x1', symbol: 'BASE', decimals: 18 },
}
function tick(index, gross, net) {
  return { tick: index, liquidityGross: String(gross), liquidityNet: String(net) }
}
function state(overrides = {}) {
  return {
    block: { number: 1, hash: '0x1', timestamp: 1 },
    sqrtPriceX96: Q96.toString(),
    tick: 0,
    liquidity: UNIT.toString(),
    ticks: [tick(-6000, UNIT, UNIT), tick(6000, UNIT, -UNIT)],
    coverage: { tickLower: -6000, tickUpper: 6000 },
    ...overrides,
  }
}
function quote(tokenIn, amount = UNIT / 10n, snapshot = state(), market = pool, extra = {}) {
  return quoteExactInput({ pool: market, state: snapshot, tokenIn, amountInRaw: String(amount), ...extra })
}

describe('bounded Uniswap v3 exact-input quotes', () => {
  it.each([0, 1])('zero input leaves state unchanged for token %s', (tokenIn) => {
    const result = quote(tokenIn, 0n)
    expect(result).toMatchObject({
      status: 'complete',
      amountInConsumedRaw: '0',
      amountOutRaw: '0',
      unfilledAmountInRaw: '0',
      feeAmountRaw: '0',
      sqrtPriceX96After: Q96.toString(),
      tickAfter: 0,
      liquidityAfter: UNIT.toString(),
      priceBefore: 1,
      priceAfter: 1,
      averageExecutionPrice: null,
      marginalImpactBps: 0,
      executionAuthority: 'none',
    })
  })
  it('matches independent constant-liquidity protocol vectors in both directions', () => {
    const buy = quote(0)
    const sell = quote(1)
    expect(buy).toMatchObject({
      status: 'complete',
      amountOutRaw: '90909090909090909',
      sqrtPriceX96After: '72025602285694852357767227579',
    })
    expect(sell).toMatchObject({
      status: 'complete',
      amountOutRaw: '90909090909090909',
      sqrtPriceX96After: '87150978765690771352898345369',
    })
    expect(buy.priceAfter).toBeCloseTo(1.21, 12)
    expect(buy.averageExecutionPrice).toBeCloseTo(1.1, 12)
    expect(sell.priceAfter).toBeCloseTo(1 / 1.21, 12)
    expect(sell.averageExecutionPrice).toBeCloseTo(1 / 1.1, 12)
  })
  it('matches the official fee-inclusive exact-input output without crossing an initialized tick', () => {
    const result = quote(
      1,
      UNIT,
      state({
        liquidity: String(UNIT * 2n),
        ticks: [],
        coverage: { tickLower: -60000, tickUpper: 60000 },
      }),
      { ...pool, feePips: 600 },
    )
    expect(result).toMatchObject({
      status: 'complete',
      amountInConsumedRaw: String(UNIT),
      amountOutRaw: '666399946655997866',
      feeAmountRaw: '600000000000000',
    })
  })
  it.each([0, 1])('reports only the filled prefix at known coverage for token %s', (tokenIn) => {
    const snapshot = state({
      ticks: [tick(-120, UNIT, UNIT), tick(120, UNIT, -UNIT)],
      coverage: { tickLower: -120, tickUpper: 120 },
    })
    const result = quote(tokenIn, UNIT, snapshot)
    expect(result.status).toBe('partial')
    expect(result.reason).toBe('coverage-exhausted')
    expect(BigInt(result.amountInConsumedRaw) + BigInt(result.unfilledAmountInRaw)).toBe(UNIT)
    expect(BigInt(result.amountOutRaw)).toBeGreaterThan(0n)
    expect(result.sqrtPriceX96After).toBe(getSqrtRatioAtTick(tokenIn === 0 ? -120 : 120).toString())
    expect(result.tickAfter).toBe(tokenIn === 0 ? -121 : 120)
    expect(result.liquidityAfter).toBe('0')
  })
  it('cannot produce an unlimited quote at the coverage boundary', () => {
    const snapshot = state({ sqrtPriceX96: getSqrtRatioAtTick(6000).toString(), tick: 6000, liquidity: '0' })
    expect(quote(1, UNIT, snapshot)).toMatchObject({
      status: 'partial',
      reason: 'coverage-exhausted',
      amountInConsumedRaw: '0',
      amountOutRaw: '0',
      unfilledAmountInRaw: String(UNIT),
    })
  })
  it.each([0, 1])('crosses a known zero-L gap before resuming fills for token %s', (tokenIn) => {
    const snapshot = state({
      liquidity: '0',
      coverage: { tickLower: -120, tickUpper: 120 },
      ticks: [tick(-120, UNIT, UNIT), tick(-60, UNIT, -UNIT), tick(60, UNIT, UNIT), tick(120, UNIT, -UNIT)],
    })
    const result = quote(tokenIn, UNIT / 1000n, snapshot)
    expect(result.status).toBe('complete')
    expect(result.liquidityAfter).toBe(UNIT.toString())
    expect(BigInt(result.amountOutRaw)).toBeGreaterThan(0n)
    expect(tokenIn === 0 ? result.tickAfter < -60 : result.tickAfter > 60).toBe(true)
    expect(result.feeAmountRaw).toBe('0')
  })
  it('crosses an initialized tick at the current price with the direction-specific L sign', () => {
    const snapshot = state({
      liquidity: String(UNIT * 2n),
      ticks: [tick(-6000, UNIT, UNIT), tick(0, UNIT, UNIT), tick(6000, UNIT * 2n, -UNIT * 2n)],
    })
    expect(quote(0, UNIT / 1000n, snapshot).liquidityAfter).toBe(UNIT.toString())
    expect(quote(1, UNIT / 1000n, snapshot).liquidityAfter).toBe(String(UNIT * 2n))
    const leftBoundary = { ...snapshot, tick: -1, liquidity: String(UNIT) }
    expect(quote(1, UNIT / 1000n, leftBoundary).liquidityAfter).toBe(String(UNIT * 2n))
  })
  it('deeper active liquidity reduces marginal and execution price impact for fixed input', () => {
    const shallow = quote(0)
    const deeper = quote(
      0,
      UNIT / 10n,
      state({
        liquidity: String(UNIT * 4n),
        ticks: [tick(-6000, UNIT * 4n, UNIT * 4n), tick(6000, UNIT * 4n, -UNIT * 4n)],
      }),
    )
    expect(deeper.marginalImpactBps).toBeLessThan(shallow.marginalImpactBps)
    expect(deeper.executionImpactBps).toBeLessThan(shallow.executionImpactBps)
    expect(BigInt(deeper.amountOutRaw)).toBeGreaterThan(BigInt(shallow.amountOutRaw))
  })
  it('uses token decimals and base orientation only for presentation, never raw fills', () => {
    const result = quote(0)
    const usdc = quote(0, UNIT / 10n, state(), { ...pool, token0: { ...pool.token0, decimals: 6 } })
    expect(usdc.amountOutRaw).toBe(result.amountOutRaw)
    expect(usdc.priceBefore).toBeCloseTo(1e12, 0)
    expect(usdc.averageExecutionPrice / result.averageExecutionPrice).toBeCloseTo(1e12, 0)
    const inverted = quote(0, UNIT / 10n, state(), { ...pool, baseTokenIndex: 0 })
    expect(inverted.priceAfter).toBeCloseTo(1 / result.priceAfter, 12)
    expect(inverted.averageExecutionPrice).toBeCloseTo(1 / result.averageExecutionPrice, 12)
  })
  it('preserves fee rounding at uninitialized bitmap word boundaries', () => {
    const snapshot = state({ ticks: [], coverage: { tickLower: -1200, tickUpper: 1200 } })
    const result = quote(1, UNIT / 20n, snapshot, { ...pool, tickSpacing: 1, feePips: 3000 })
    expect(result.status).toBe('complete')
    expect(result.steps).toBeGreaterThan(1)
    expect(BigInt(result.feeAmountRaw)).toBeGreaterThan(((UNIT / 20n) * 3000n) / 1000000n)
    expect(BigInt(result.amountInConsumedRaw)).toBe(UNIT / 20n)
  })
  it('returns a bounded partial result when the computational step budget is exhausted', () => {
    const result = quote(
      1,
      UNIT / 20n,
      state({ ticks: [], coverage: { tickLower: -1200, tickUpper: 1200 } }),
      { ...pool, tickSpacing: 1 },
      { maxSteps: 1 },
    )
    expect(result).toMatchObject({ status: 'partial', reason: 'step-limit', steps: 1 })
    expect(BigInt(result.unfilledAmountInRaw)).toBeGreaterThan(0n)
  })
  it('does not mutate the observed snapshot', () => {
    const snapshot = state()
    const before = JSON.stringify(snapshot)
    quote(0, UNIT, snapshot)
    expect(JSON.stringify(snapshot)).toBe(before)
  })
  it.each([
    { tick: 10 },
    { ticks: [tick(60, 1n, 2n)] },
    { ticks: [tick(60, 1n, 1n), tick(60, 1n, 1n)] },
    { coverage: { tickLower: 1, tickUpper: 10 } },
    { liquidity: '-1' },
  ])('rejects inconsistent snapshots instead of fabricating fills: %j', (override) => {
    expect(quote(0, UNIT, state(override))).toMatchObject({ status: 'invalid', amountOutRaw: null })
  })
  it('rejects impossible negative liquidity after a signed crossing', () => {
    expect(quote(0, UNIT, state({ liquidity: '1', ticks: [tick(0, 2n, 2n)] }))).toMatchObject({
      status: 'invalid',
      reason: 'invalid-crossed-liquidity',
    })
  })
})
