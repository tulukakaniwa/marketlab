import { describe, expect, it } from 'vitest'
import { estimateInverseEthHedge } from './executionBook.js'
import { makeOptionsFixture } from './__tests__/optionsFixtures.js'

function estimate(amount, change = () => {}) {
  const fixture = makeOptionsFixture()
  change(fixture)
  return estimateInverseEthHedge(fixture.underlyingBook, fixture.underlyingInstrument, amount)
}

describe('inverse ETH visible-depth estimate', () => {
  it('converts USD quantity to ETH at each ask, preserving average versus marginal price', () => {
    const result = estimate(2)
    expect(result).toMatchObject({
      status: 'complete',
      side: 'buy',
      filledEth: 2,
      unfilledEth: 0,
      usdNotional: 2300,
      averagePriceUsd: 1150,
      marginalPriceUsd: 1200,
    })
    expect(result.fills.map((fill) => fill.amountEth)).toEqual([1, 1])
    expect(result.averageImpactBps).toBeCloseTo((1150 / 1050 - 1) * 10000)
    expect(result.marginalImpactBps).toBeGreaterThan(result.averageImpactBps)
    expect(result).toMatchObject({
      executionAuthority: 'none',
      quantityModel: 'continuous-depth-estimate',
      quantityUnit: 'USD-notional',
      feesIncluded: false,
      fundingIncluded: false,
    })
  })

  it('sells into bids and distinguishes signed price impact from adverse impact', () => {
    const result = estimate(-1.5)
    expect(result).toMatchObject({
      status: 'complete',
      side: 'sell',
      signedFilledEth: -1.5,
      usdNotional: 1450,
      marginalPriceUsd: 900,
    })
    expect(result.averagePriceUsd).toBeCloseTo(1450 / 1.5)
    expect(result.averageImpactBps).toBeLessThan(0)
    expect(result.adverseAverageImpactBps).toBeGreaterThan(0)
  })

  it('retains unfilled ETH instead of extending visible depth', () => {
    const result = estimate(4)
    expect(result).toMatchObject({
      status: 'partial',
      filledEth: 3,
      unfilledEth: 1,
      usdNotional: 3500,
      issues: ['visible-depth-exhausted'],
    })
    expect(result.fills).toHaveLength(2)
  })

  it('does not invent a zero price or zero impact when there is no hedge', () => {
    expect(estimate(0)).toMatchObject({
      status: 'no-hedge',
      side: 'none',
      filledEth: 0,
      usdNotional: 0,
      averagePriceUsd: null,
      marginalPriceUsd: null,
      averageImpactBps: null,
      fills: [],
    })
  })

  it.each([
    [
      'ETH quantities mislabeled as USD',
      (x) => {
        x.underlyingInstrument.contract_size = 10
      },
    ],
    [
      'unsorted asks',
      (x) => {
        x.underlyingBook.asks.reverse()
      },
    ],
    [
      'crossed book',
      (x) => {
        x.underlyingBook.bids[0][0] = 1100
        x.underlyingBook.best_bid_price = 1100
      },
    ],
    [
      'fractional USD contracts',
      (x) => {
        x.underlyingBook.asks[0][1] = 1.5
      },
    ],
    [
      'missing depth',
      (x) => {
        x.underlyingBook.asks = []
      },
    ],
  ])('blocks %s', (_, change) => {
    expect(estimate(1, change)).toMatchObject({ status: 'blocked', filledEth: null, usdNotional: null, fills: [] })
  })
})
