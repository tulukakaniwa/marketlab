// @vitest-environment node
import { createHash } from 'node:crypto'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { runEthImpactJob } from '../ethImpactResearch.worker.js'
import { analyzeEthLpBundle } from '../../domain/market-impact/ethLpResearch.js'
import { analyzeEthOptionsBundle } from '../../domain/market-impact/ethOptionsResearch.js'

vi.mock('../../domain/market-impact/ethLpResearch.js', () => ({
  analyzeEthLpBundle: vi.fn(() => ({ status: 'verified', issues: [] })),
}))
vi.mock('../../domain/market-impact/ethOptionsResearch.js', () => ({
  analyzeEthOptionsBundle: vi.fn(() => ({ status: 'ready', issues: [], scenario: { status: 'disabled' } })),
}))
const digest = async (text) => createHash('sha256').update(text).digest('hex')
const encode = (value) => new TextEncoder().encode(JSON.stringify(value)).buffer
async function envelope(kind, bundle = { source: 'test' }) {
  return { format: `market-lab-eth-${kind}-local-v1`, sha256: await digest(JSON.stringify(bundle)), bundle }
}
beforeEach(() => vi.clearAllMocks())

describe('research import integrity boundary', () => {
  it('blocks a modified payload before domain computation or verified notification', async () => {
    const input = await envelope('lp')
    input.bundle.source = 'changed'
    const onVerified = vi.fn()
    const result = await runEthImpactJob({ kind: 'lp', buffer: encode(input) }, { digest, onVerified })
    expect(result.hashVerified).toBe(false)
    expect(result.report).toBeNull()
    expect(result.issues[0]).toContain('SHA256')
    expect(analyzeEthLpBundle).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
  })

  it('rejects a valid hash when the envelope belongs to the other market', async () => {
    const result = await runEthImpactJob({ kind: 'lp', buffer: encode(await envelope('options')) }, { digest })
    expect(result.hashVerified).toBe(false)
    expect(analyzeEthLpBundle).not.toHaveBeenCalled()
    expect(analyzeEthOptionsBundle).not.toHaveBeenCalled()
  })

  it('verifies exact serialized content before invoking options with the default scenario off', async () => {
    const input = await envelope('options', { data: ['observed', 0, null] })
    const onVerified = vi.fn()
    const result = await runEthImpactJob({ kind: 'options', buffer: encode(input) }, { digest, onVerified })
    expect(result.hashVerified).toBe(true)
    expect(result.report.scenario.status).toBe('disabled')
    expect(onVerified).toHaveBeenCalledOnce()
    expect(analyzeEthOptionsBundle).toHaveBeenCalledWith(input.bundle, {
      enabled: false,
      hedgeRatio: 1,
      alreadyHedgedEth: 0,
    })
  })

  it('preserves explicitly chosen hedge assumptions and domain blocking', async () => {
    analyzeEthOptionsBundle.mockReturnValueOnce({ status: 'blocked', issues: ['source-time-order-invalid'] })
    const scenario = { enabled: true, hedgeRatio: 0.25, alreadyHedgedEth: -3 }
    const result = await runEthImpactJob(
      { kind: 'options', buffer: encode(await envelope('options')), scenario },
      { digest },
    )
    expect(analyzeEthOptionsBundle.mock.calls[0][1]).toEqual(scenario)
    expect(result).toMatchObject({
      hashVerified: true,
      report: { status: 'blocked' },
      issues: ['source-time-order-invalid'],
    })
  })

  it('returns a blocked result for malformed JSON without calling domain', async () => {
    const result = await runEthImpactJob({ kind: 'lp', buffer: new TextEncoder().encode('{').buffer }, { digest })
    expect(result.report).toBeNull()
    expect(result.hashVerified).toBe(false)
    expect(analyzeEthLpBundle).not.toHaveBeenCalled()
  })
})
