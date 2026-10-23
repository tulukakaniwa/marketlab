import { describe, expect, it } from 'vitest'
import { decodePoolLog } from './uniswapV3EventEvidence.js'
import { replayPoolEvents } from './uniswapV3Replay.js'
import { fixtureBlock, fixtureEvent, hashFor, makeReplayFixture, refreshRawLogs, sqrtAt } from './__tests__/fixtures.js'

function oneEventFixture(event, expected) {
  const bundle = makeReplayFixture()
  bundle.events = [event]
  bundle.scan.toBlock = 101
  bundle.blocks = [fixtureBlock(100), fixtureBlock(101)]
  bundle.checkpoint = { ...structuredClone(bundle.seed), block: fixtureBlock(101), ...expected }
  return refreshRawLogs(bundle)
}

describe('bounded Uniswap v3 chronological pool replay', () => {
  it('uses signed boundary net liquidity, observes Swap endpoints and keeps Collect inert', () => {
    const bundle = makeReplayFixture()
    const original = structuredClone(bundle)
    const result = replayPoolEvents(bundle)
    expect(result.status).toBe('verified')
    expect(result.executionAuthority).toBe('none')
    expect(result.eventCounts).toEqual({ Mint: 1, Burn: 1, Swap: 1, Collect: 1 })
    expect(result.stepsScope).toBe('liquidity-actions')
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].before.liquidity).toBe('1000000000000000')
    expect(result.steps[0].after.liquidity).toBe('1200000000000000')
    expect(result.steps[1].before.liquidity).toBe('1000000000000000')
    expect(result.steps[1].after.liquidity).toBe('900000000000000')
    expect(result.state).toEqual({ ...bundle.checkpoint, cursor: { kind: 'end-of-block', blockNumber: 104 } })
    expect([result.steps[0].before.cursor, result.steps[0].after.cursor]).toEqual([
      { kind: 'before-log', blockNumber: 101, transactionIndex: 0, logIndex: 0 },
      { kind: 'after-log', blockNumber: 101, transactionIndex: 0, logIndex: 0 },
    ])
    expect(result.availableAt).toBe(bundle.provenance.availableAt)
    expect(bundle).toEqual(original)
  })

  it('updates active L for a Mint whose two boundaries are outside known coverage', () => {
    const event = fixtureEvent('Mint', 101, {
      tickLower: 199880,
      tickUpper: 200120,
      liquidityDeltaRaw: '200000000000000',
      amount0Raw: '1',
      amount1Raw: '2',
    })
    const bundle = oneEventFixture(event, { liquidity: '1200000000000000' })
    const result = replayPoolEvents(bundle)
    expect(result.status).toBe('verified')
    expect(result.state.ticks).toEqual(bundle.seed.ticks)
    expect(result.steps[0].after.liquidity).toBe('1200000000000000')
  })

  it('keeps a zero Burn fee poke from changing depth', () => {
    const event = fixtureEvent('Burn', 101, {
      tickLower: 199940,
      tickUpper: 200060,
      liquidityDeltaRaw: '0',
      amount0Raw: '0',
      amount1Raw: '0',
    })
    const result = replayPoolEvents(oneEventFixture(event))
    expect(result.status).toBe('verified')
    expect(result.steps[0].before.ticks).toEqual(result.steps[0].after.ticks)
    expect(result.steps[0].before.liquidity).toBe(result.steps[0].after.liquidity)
  })

  it('subtracts liquidityNet on downward crossings, including exact-boundary tick minus one', () => {
    for (const [tick, priceTick] of [
      [199930, 199930],
      [199939, 199940],
    ]) {
      const event = fixtureEvent('Swap', 101, {
        amount0Raw: '10000',
        amount1Raw: '-1000',
        sqrtPriceX96: sqrtAt(priceTick),
        tick,
        liquidity: '0',
      })
      const result = replayPoolEvents(
        oneEventFixture(event, { sqrtPriceX96: event.sqrtPriceX96, tick, liquidity: '0' }),
      )
      expect(result.status).toBe('verified')
      expect(result.state.liquidity).toBe('0')
    }
  })

  it('permits a zero-cost boundary crossing followed by an empty interval', () => {
    const event = fixtureEvent('Swap', 101, {
      amount0Raw: '0',
      amount1Raw: '0',
      sqrtPriceX96: sqrtAt(199930),
      tick: 199930,
      liquidity: '0',
    })
    const bundle = oneEventFixture(event, { sqrtPriceX96: event.sqrtPriceX96, tick: event.tick, liquidity: '0' })
    bundle.seed.tick = 199940
    bundle.seed.sqrtPriceX96 = sqrtAt(199940)
    expect(replayPoolEvents(bundle).status).toBe('verified')
  })

  it('uses closed sqrt coverage, accepting the official lower-boundary tick minus one state', () => {
    const event = fixtureEvent('Swap', 101, {
      amount0Raw: '10000',
      amount1Raw: '-1000',
      sqrtPriceX96: sqrtAt(199940),
      tick: 199939,
      liquidity: '0',
    })
    const bundle = oneEventFixture(event, { sqrtPriceX96: event.sqrtPriceX96, tick: event.tick, liquidity: '0' })
    bundle.seed.coverage.tickLower = 199940
    bundle.checkpoint.coverage.tickLower = 199940
    expect(replayPoolEvents(bundle).status).toBe('verified')
    const inward = fixtureEvent('Swap', 101, {
      amount0Raw: '-1000',
      amount1Raw: '10000',
      sqrtPriceX96: sqrtAt(199945),
      tick: 199945,
      liquidity: '1000000000000000',
    })
    const returnBundle = oneEventFixture(inward, { sqrtPriceX96: inward.sqrtPriceX96, tick: inward.tick })
    Object.assign(returnBundle.seed, { sqrtPriceX96: sqrtAt(199940), tick: 199939, liquidity: '0' })
    returnBundle.seed.coverage.tickLower = 199940
    returnBundle.checkpoint.coverage.tickLower = 199940
    expect(replayPoolEvents(returnBundle).status).toBe('verified')
  })

  it('rejects a sqrt just above upper coverage even when slot0.tick equals its upper tick', () => {
    const event = fixtureEvent('Swap', 101, {
      amount0Raw: '-1000',
      amount1Raw: '10000',
      sqrtPriceX96: (BigInt(sqrtAt(200060)) + 1n).toString(),
      tick: 200060,
      liquidity: '0',
    })
    const bundle = oneEventFixture(event, { sqrtPriceX96: event.sqrtPriceX96, tick: event.tick, liquidity: '0' })
    bundle.seed.coverage.tickUpper = 200060
    bundle.checkpoint.coverage.tickUpper = 200060
    expect(replayPoolEvents(bundle).issues).toContain('price-outside-tick-coverage')
  })

  it('rejects a free price move through positive depth and a false observed active L', () => {
    const event = fixtureEvent('Swap', 101, {
      amount0Raw: '0',
      amount1Raw: '0',
      sqrtPriceX96: sqrtAt(200004),
      tick: 200004,
      liquidity: '1000000000000000',
    })
    const result = replayPoolEvents(oneEventFixture(event, { sqrtPriceX96: event.sqrtPriceX96, tick: event.tick }))
    expect(result.status).toBe('blocked')
    expect(result.issues).toContain('zero-amount-through-positive-liquidity')
    const bundle = makeReplayFixture()
    bundle.events[1].liquidity = '1200000000000000'
    refreshRawLogs(bundle)
    expect(replayPoolEvents(bundle).issues).toContain('swap-active-liquidity-mismatch')
  })

  it('never uses a later price or checkpoint to form an earlier LP snapshot', () => {
    const baseline = makeReplayFixture()
    const originalStep = replayPoolEvents(baseline).steps[0]
    const changed = makeReplayFixture()
    changed.events[1].tick = 200030
    changed.events[1].sqrtPriceX96 = sqrtAt(200030)
    changed.checkpoint.tick = 200030
    changed.checkpoint.sqrtPriceX96 = sqrtAt(200030)
    refreshRawLogs(changed)
    const result = replayPoolEvents(changed)
    expect(result.status).toBe('verified')
    expect(result.steps[0]).toEqual(originalStep)
    const prefix = oneEventFixture(baseline.events[0], originalStep.after)
    expect(replayPoolEvents(prefix).steps[0]).toEqual(originalStep)
  })

  it('checks every endpoint tick, including balanced gross liquidity invisible to net L', () => {
    const bundle = makeReplayFixture()
    bundle.checkpoint.ticks[1].liquidityGross = '200000000000002'
    expect(replayPoolEvents(bundle).issues).toContain('endpoint-checkpoint-mismatch')
    bundle.checkpoint = structuredClone(bundle.seed)
    bundle.checkpoint.block = fixtureBlock(104)
    expect(replayPoolEvents(bundle).issues).toContain('endpoint-checkpoint-mismatch')
  })

  it('removes an initialized tick when its gross liquidity becomes zero', () => {
    const event = fixtureEvent('Burn', 101, {
      tickLower: 199940,
      tickUpper: 200060,
      liquidityDeltaRaw: '-1000000000000000',
      amount0Raw: '1',
      amount1Raw: '1',
    })
    const result = replayPoolEvents(oneEventFixture(event, { liquidity: '0', ticks: [] }))
    expect(result.status).toBe('verified')
    expect(result.state.ticks).toEqual([])
  })

  it('bounds event work and can avoid retaining historical depth snapshots', () => {
    expect(replayPoolEvents(makeReplayFixture(), { maxEvents: 3 }).issues).toContain('replay-event-limit')
    const result = replayPoolEvents(makeReplayFixture(), { includeSteps: false })
    expect(result.status).toBe('verified')
    expect(result.steps).toEqual([])
    expect(result.state.liquidity).toBe('900000000000000')
  })
})

describe('pool replay evidence admission', () => {
  const invalidCases = [
    [
      'missing schema',
      (bundle) => {
        delete bundle.schemaVersion
      },
    ],
    [
      'missing scan completeness',
      (bundle) => {
        bundle.scan.complete = false
      },
    ],
    [
      'missing raw evidence',
      (bundle) => {
        bundle.rawLogs = []
      },
    ],
    [
      'mutated decoded amount',
      (bundle) => {
        bundle.events[0].amount0Raw = '900'
      },
    ],
    [
      'removed event',
      (bundle) => {
        bundle.rawLogs[0].removed = true
      },
    ],
    [
      'orphan log hash',
      (bundle) => {
        bundle.rawLogs[0].blockHash = hashFor(999)
      },
    ],
    [
      'missing canonical header',
      (bundle) => {
        bundle.blocks.splice(2, 1)
      },
    ],
    [
      'broken parent link',
      (bundle) => {
        bundle.blocks[2].parentHash = hashFor(999)
      },
    ],
    [
      'header timestamp reversal',
      (bundle) => {
        bundle.blocks[2].timestamp = bundle.blocks[1].timestamp
      },
    ],
    [
      'wrong seed binding',
      (bundle) => {
        bundle.seed.block.hash = hashFor(999)
      },
    ],
    [
      'stale evidence timestamp',
      (bundle) => {
        bundle.provenance.availableAt = '2000-01-01T00:00:00Z'
      },
    ],
    [
      'unfinalized evidence',
      (bundle) => {
        bundle.provenance.finality = 'latest'
      },
    ],
    [
      'unknown token identity',
      (bundle) => {
        bundle.pool.token0.symbol = 'USDT'
      },
    ],
    [
      'unknown pool identity',
      (bundle) => {
        bundle.pool.poolAddress = `0x${'1'.repeat(40)}`
      },
    ],
    [
      'wrong pool fee',
      (bundle) => {
        bundle.pool.feePips = 3000
      },
    ],
    [
      'wrong tick spacing',
      (bundle) => {
        bundle.pool.tickSpacing = 60
      },
    ],
    [
      'event timestamp mismatch',
      (bundle) => {
        bundle.events[0].eventTime = '2000-01-01T00:00:00Z'
      },
    ],
    [
      'out of order logs',
      (bundle) => {
        bundle.events.reverse()
        bundle.rawLogs.reverse()
      },
    ],
    [
      'duplicate log',
      (bundle) => {
        bundle.events.splice(1, 0, bundle.events[0])
        bundle.rawLogs.splice(1, 0, bundle.rawLogs[0])
      },
    ],
    [
      'negative seed L',
      (bundle) => {
        bundle.seed.liquidity = '-1'
      },
    ],
    [
      'unknown depth at a swap',
      (bundle) => {
        bundle.seed.coverage.tickUpper = 200010
        bundle.checkpoint.coverage.tickUpper = 200010
      },
    ],
  ]
  it.each(invalidCases)('blocks %s without an actionable state', (_, mutate) => {
    const bundle = makeReplayFixture()
    mutate(bundle)
    const result = replayPoolEvents(bundle)
    expect(result.status).toBe('blocked')
    expect(result.issues.length).toBeGreaterThan(0)
    expect(result.state).toBeNull()
    expect(result.steps).toEqual([])
    expect(result.executionAuthority).toBe('none')
  })

  it('rejects over-burning rather than inventing missing boundary liquidity', () => {
    const bundle = makeReplayFixture()
    bundle.events[2].liquidityDeltaRaw = '-2000000000000000'
    refreshRawLogs(bundle)
    expect(replayPoolEvents(bundle).issues).toContain('gross-liquidity-out-of-range')
  })

  it('decodes signed ABI amounts and rejects noncanonical int24 sign extension', () => {
    const bundle = makeReplayFixture()
    expect(decodePoolLog(bundle.rawLogs[1], bundle.blocks[2])).toEqual(bundle.events[1])
    const log = structuredClone(bundle.rawLogs[0])
    log.topics[2] = `0x${'0'.repeat(58)}ffffff`
    expect(() => decodePoolLog(log, bundle.blocks[1])).toThrow('noncanonical-abi-word')
  })
})
