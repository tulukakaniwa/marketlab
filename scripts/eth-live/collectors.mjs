import { collectEthLpWindow } from '../eth-lp/collect.mjs'
import { saveBundle } from '../eth-lp/localFiles.mjs'
import { collectEthMarketSnapshot } from '../eth-market/collect.mjs'
import { saveMarketBundle } from '../eth-market/localFiles.mjs'
import { collectEthOptionsSnapshot } from '../eth-options/collect.mjs'
import { saveOptionsBundle } from '../eth-options/localFiles.mjs'
import { fileURLToPath } from 'node:url'
import { createArchiveWriter } from './archiveBudget.mjs'

export function createBoundedCollection({ fetchImpl = globalThis.fetch, writeArchive, timers = globalThis }) {
  const controllers = new Set()
  async function bounded(milliseconds, collect, save) {
    const controller = new AbortController()
    controllers.add(controller)
    const timer = timers.setTimeout(
      () => controller.abort(new DOMException('Collection deadline', 'TimeoutError')),
      milliseconds,
    )
    const boundedFetch = (url, options = {}) =>
      fetchImpl(url, {
        ...options,
        signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
      })
    try {
      const bundle = await collect(boundedFetch)
      controller.signal.throwIfAborted()
      const path = await writeArchive(bundle, save, controller.signal)
      controller.signal.throwIfAborted()
      return path
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason
      throw error
    } finally {
      timers.clearTimeout(timer)
      controllers.delete(controller)
    }
  }
  return {
    run: bounded,
    stop() {
      for (const controller of controllers) controller.abort()
    },
  }
}

export function createLiveCollectors({ rpcUrl = process.env.ETH_RPC_URL, fetchImpl = globalThis.fetch } = {}) {
  const collection = createBoundedCollection({
    fetchImpl,
    writeArchive: createArchiveWriter(fileURLToPath(new URL('../../', import.meta.url))),
  })
  return {
    market: () =>
      collection.run(
        45000,
        (fetchImpl) => collectEthMarketSnapshot({ interval: '5m', limit: 288, fetchImpl }),
        saveMarketBundle,
      ),
    options: () =>
      collection.run(90000, (fetchImpl) => collectEthOptionsSnapshot({ tradeCount: 12, fetchImpl }), saveOptionsBundle),
    lp: () =>
      collection.run(
        180000,
        (fetchImpl) => collectEthLpWindow({ ...(rpcUrl ? { rpcUrl } : {}), blockCount: 100, wordRadius: 1, fetchImpl }),
        saveBundle,
      ),
    stop: collection.stop,
  }
}
