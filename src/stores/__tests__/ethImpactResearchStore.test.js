import { describe, expect, it, vi } from 'vitest'
import { createEthImpactResearchController, ETH_IMPACT_FILE_LIMIT } from '../ethImpactResearchStore.js'

const file = (name = 'research.json') => ({ name, size: 8, arrayBuffer: vi.fn(async () => new ArrayBuffer(8)) })
function harness() {
  const workers = []
  const controller = createEthImpactResearchController({
    workerFactory: () => {
      const worker = {
        terminate: vi.fn(),
        postMessage: vi.fn(),
        reply(result) {
          this.onmessage({ data: { id: this.postMessage.mock.calls[0][0].id, result } })
        },
      }
      workers.push(worker)
      return worker
    },
  })
  return { controller, workers }
}
const ready = (id) => ({ hashVerified: true, report: { status: 'verified', id, actions: [{ id }] }, issues: [] })

describe('ETH impact research ViewModel lifecycle', () => {
  it('invalidates market candles immediately and ignores stale results without touching LP/options', async () => {
    const { controller, workers } = harness()
    await controller.importFile('lp', file('lp.json'))
    workers[0].reply(ready('lp'))
    await controller.importFile('market', file('old-market.json'))
    workers[1].reply({ hashVerified: true, report: { status: 'ready', rows: [{ close: 2400 }] }, issues: [] })
    expect(controller.market.value.report.rows).toHaveLength(1)
    await controller.importFile('market', file('new-market.json'))
    expect(controller.market.value).toMatchObject({ phase: 'verifying', report: null })
    workers[1].reply(ready('stale'))
    expect(controller.market.value.report).toBeNull()
    controller.clear('market')
    workers[2].reply(ready('cleared'))
    expect(controller.market.value).toMatchObject({ phase: 'idle', report: null })
    expect(controller.lp.value.report.id).toBe('lp')
    expect(controller.options.value.phase).toBe('idle')
  })

  it('ignores an old worker result after a newer file import', async () => {
    const { controller, workers } = harness()
    await controller.importFile('lp', file('old.json'))
    await controller.importFile('lp', file('new.json'))
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    workers[1].reply(ready('new'))
    workers[0].reply(ready('old'))
    expect(controller.lp.value.filename).toBe('new.json')
    expect(controller.activeAction.value.id).toBe('new')
    expect(controller.lp.value.phase).toBe('ready')
  })

  it('does not create a worker when a superseded file finishes reading late', async () => {
    const { controller, workers } = harness()
    let finishOldRead
    const old = file('slow.json')
    old.arrayBuffer = () =>
      new Promise((resolve) => {
        finishOldRead = resolve
      })
    const pending = controller.importFile('lp', old)
    await controller.importFile('lp', file('latest.json'))
    finishOldRead(new ArrayBuffer(8))
    await pending
    expect(workers).toHaveLength(1)
    workers[0].reply(ready('latest'))
    expect(controller.lp.value.filename).toBe('latest.json')
  })

  it('keeps a hash failure blocked and never exposes a prior report', async () => {
    const { controller, workers } = harness()
    await controller.importFile('lp', file())
    workers[0].reply(ready('first'))
    await controller.importFile('lp', file('bad-hash.json'))
    workers[1].reply({ report: null, hashVerified: false, issues: ['SHA256 不匹配'] })
    expect(controller.lp.value).toMatchObject({ phase: 'blocked', report: null, hashVerified: false })
    expect(controller.activeAction.value).toBeNull()
    expect(controller.lp.value.issues).toEqual(['SHA256 不匹配'])
  })

  it('starts and reimports options with the hypothetical hedge disabled', async () => {
    const { controller, workers } = harness()
    expect(controller.optionScenario.value).toEqual({ enabled: false, hedgeRatio: 1, alreadyHedgedEth: 0 })
    await controller.importFile('options', file())
    expect(workers[0].postMessage.mock.calls[0][0].scenario.enabled).toBe(false)
    await controller.setOptionScenario({ enabled: true, hedgeRatio: 0.5, alreadyHedgedEth: -2 })
    expect(workers[1].postMessage.mock.calls[0][0].scenario).toEqual({
      enabled: true,
      hedgeRatio: 0.5,
      alreadyHedgedEth: -2,
    })
    await controller.importFile('options', file('next.json'))
    expect(workers[2].postMessage.mock.calls[0][0].scenario).toEqual({
      enabled: false,
      hedgeRatio: 1,
      alreadyHedgedEth: 0,
    })
    workers[1].reply({ hashVerified: true, report: { status: 'ready', scenario: { status: 'ready' } } })
    expect(controller.options.value.phase).toBe('verifying')
  })

  it('rejects oversized files before reading or dispatching work', async () => {
    const { controller, workers } = harness()
    const oversized = { ...file(), size: ETH_IMPACT_FILE_LIMIT + 1 }
    await controller.importFile('lp', oversized)
    expect(oversized.arrayBuffer).not.toHaveBeenCalled()
    expect(workers).toHaveLength(0)
    expect(controller.lp.value.phase).toBe('blocked')
  })

  it('cancels work on panel exit while allowing an import after remount', async () => {
    const { controller, workers } = harness()
    await controller.importFile('lp', file())
    controller.cancelPending()
    workers[0].reply(ready('cancelled'))
    expect(controller.lp.value.phase).toBe('idle')
    await controller.importFile('lp', file('returned.json'))
    workers[1].reply(ready('returned'))
    expect(controller.lp.value.report.id).toBe('returned')
  })

  it('clearing one lane does not cancel another market and dispose ignores late results', async () => {
    const { controller, workers } = harness()
    await controller.importFile('lp', file())
    await controller.importFile('options', file())
    controller.clear('lp')
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(workers[1].terminate).not.toHaveBeenCalled()
    controller.dispose()
    workers[1].reply(ready('late'))
    await controller.importFile('lp', file())
    expect(workers).toHaveLength(2)
    expect(controller.options.value.report).toBeNull()
  })
})
