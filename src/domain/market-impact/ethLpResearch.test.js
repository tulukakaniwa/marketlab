import { describe, expect, it } from 'vitest'
import { analyzeEthLpBundle } from './ethLpResearch.js'
import { makeReplayFixture, refreshRawLogs } from './__tests__/fixtures.js'

const probes = { baseAmountRaw: '1000000000000', quoteAmountRaw: '1000' }

describe('ETH local research query', () => {
  it('does not promote an imported receipt proof claim into verified evidence', () => {
    const bundle = makeReplayFixture()
    bundle.provenance.receiptProofVerified = true
    const report = analyzeEthLpBundle(bundle, probes)
    expect(report.status).toBe('verified')
    expect(report.declaredReceiptProofVerified).toBe(true)
    expect(report.receiptProofVerified).toBe(false)
    expect(report.evidenceBasis).toBe('rpc-bundle-internal-consistency')
  })

  it('keeps observed LP actions separate from price moves and conditional orders', () => {
    const bundle = makeReplayFixture()
    const before = structuredClone(bundle)
    const report = analyzeEthLpBundle(bundle, probes)
    expect(report.status).toBe('verified')
    expect(report.executionAuthority).toBe('none')
    expect(report.dataOrigin).toBe('synthetic-fixture')
    expect(report.receiptProofVerified).toBe(false)
    expect(report.availableAt).toBe(bundle.provenance.availableAt)
    expect(report.priceUnit).toBe('USDC/WETH')
    expect(report.counts).toEqual({ Mint: 1, Burn: 1, Swap: 1, Collect: 1 })
    expect(report.actions.map((action) => action.event.type)).toEqual(['Mint', 'Burn'])
    expect(report.actions.every((action) => !action.priceMovedByLiquidityAction)).toBe(true)
    const mint = report.actions[0].sellBase
    expect(mint.before.status).toBe('complete')
    expect(mint.after.status).toBe('complete')
    expect(Math.abs(mint.after.marginalImpactBps)).toBeLessThan(Math.abs(mint.before.marginalImpactBps))
    const burn = report.actions[1].sellBase
    expect(Math.abs(burn.after.marginalImpactBps)).toBeGreaterThan(Math.abs(burn.before.marginalImpactBps))
    expect(bundle).toEqual(before)
  })

  it('later liquidity withdrawals cannot rewrite an earlier action comparison', () => {
    const bundle = makeReplayFixture()
    const original = analyzeEthLpBundle(bundle, probes)
    bundle.events[2].liquidityDeltaRaw = '-200000000000000'
    bundle.checkpoint.liquidity = '800000000000000'
    bundle.checkpoint.ticks[0].liquidityGross = '800000000000000'
    bundle.checkpoint.ticks[0].liquidityNet = '800000000000000'
    bundle.checkpoint.ticks[3].liquidityGross = '800000000000000'
    bundle.checkpoint.ticks[3].liquidityNet = '-800000000000000'
    refreshRawLogs(bundle)
    const revised = analyzeEthLpBundle(bundle, probes)
    expect(revised.status).toBe('verified')
    expect(revised.actions[0]).toEqual(original.actions[0])
    expect(revised.actions[1].sellBase.after).not.toEqual(original.actions[1].sellBase.after)
  })

  it('refuses price conclusions when checkpoint evidence fails', () => {
    const bundle = makeReplayFixture()
    bundle.checkpoint.liquidity = '800000000000000'
    const report = analyzeEthLpBundle(bundle, probes)
    expect(report.status).toBe('blocked')
    expect(report.endpointQuotes).toBeUndefined()
    expect(report.actions).toBeUndefined()
    expect(report.executionAuthority).toBe('none')
  })

  it('keeps coverage exhaustion explicit and rejects unsafe raw inputs', () => {
    const report = analyzeEthLpBundle(makeReplayFixture())
    expect(report.status).toBe('verified')
    expect(report.endpointQuotes.sellBase.status).toBe('partial')
    expect(BigInt(report.endpointQuotes.sellBase.unfilledAmountInRaw)).toBeGreaterThan(0n)
    for (const baseAmountRaw of [1e18, '-1', '0', (1n << 255n).toString()]) {
      expect(analyzeEthLpBundle(makeReplayFixture(), { baseAmountRaw }).status).toBe('blocked')
    }
  })
})
