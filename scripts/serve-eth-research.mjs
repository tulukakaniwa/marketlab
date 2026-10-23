import { fileURLToPath } from 'node:url'
import { createLiveCollectors } from './eth-live/collectors.mjs'
import { createLiveHttpServer } from './eth-live/http.mjs'
import { createLiveRepository } from './eth-live/persistence.mjs'
import { createLiveScheduler } from './eth-live/scheduler.mjs'

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.info('node scripts/serve-eth-research.mjs [--once] [--port 5180]')
    console.info('Loopback-only live ETH research: market 60s, options 120s, finalized LP 300s.')
    console.info('Writes immutable envelopes and a local retained manifest; ETH_RPC_URL may override the LP endpoint.')
    return
  }
  let once = false
  let port = 5180
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--once' && !once) once = true
    else if (args[i] === '--port' && /^\d+$/.test(args[i + 1] || '')) port = Number(args[++i])
    else throw new Error('invalid-cli-argument')
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('invalid-listen-port')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const repository = createLiveRepository(root)
  await repository.initialize()
  const scheduler = createLiveScheduler({ collectors: createLiveCollectors(), repository })
  if (once) {
    await scheduler.start({ once: true })
    console.info(JSON.stringify({ ...repository.snapshot(), lanes: scheduler.snapshot() }, null, 2))
    if (Object.values(scheduler.snapshot()).some((lane) => lane.phase === 'error')) process.exitCode = 1
    return
  }
  const server = createLiveHttpServer({ repository, scheduler })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  console.info(
    JSON.stringify({
      event: 'listening',
      url: `http://127.0.0.1:${port}`,
      intervalsSeconds: { market: 60, options: 120, lp: 300 },
    }),
  )
  void scheduler.start()
  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    scheduler.stop()
    server.close()
    server.closeAllConnections()
    await scheduler.settled()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

main().catch(() => {
  console.error(
    'ETH live research service failed to start; check local permissions, manifest integrity and port availability.',
  )
  process.exitCode = 1
})
