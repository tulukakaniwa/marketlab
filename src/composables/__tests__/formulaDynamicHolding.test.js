import { describe, expect, it } from 'vitest'
import { resolveDynamicHoldingData } from '../formulaDynamicHolding.js'

function makeInput(meanReversion) {
  return {
    graph: { inputs: { entryPrice: 80 } },
    market: { markPrice: 80, costAnchor: 100, costLow: 90, costSlope5: 0 },
    rows: Array.from({ length: 40 }, (_, index) => ({ close: 110 - index * 0.75 })),
    deviation: { z: -2.2 },
    meanReversion,
    fingerprint: null,
  }
}

describe('resolveDynamicHoldingData', () => {
  it('只让正 rho 的单调回归样本进入动态持仓模型', () => {
    const monotonic = resolveDynamicHoldingData(
      makeInput({
        rho: 0.5,
        halfLifeDays: 1,
        isMeanReverting: true,
        decayMode: 'monotonic-decay',
      }),
    )
    const oscillating = resolveDynamicHoldingData(
      makeInput({
        rho: -0.5,
        halfLifeDays: 1,
        isMeanReverting: true,
        decayMode: 'oscillating-decay',
      }),
    )

    expect(monotonic).not.toBeNull()
    expect(oscillating).toBeNull()
  })
})
