import { LIVE_KINDS } from './persistence.mjs'

export const LIVE_INTERVALS = Object.freeze({ market: 60000, options: 120000, lp: 300000 })
const iso = (time) => new Date(time).toISOString()

// Never surface raw error.message: transport errors may contain credentials or provider bodies.
export function safeCollectionError(error) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'collection-timeout'
  if (error?.code === 'ENOSPC') return 'local-storage-full'
  if (error?.code === 'ARCHIVE_QUOTA') return 'local-archive-quota-2GiB'
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'local-storage-permission'
  return 'collection-or-verification-failed'
}

/** One independent task per lane, scheduled only after its previous task settles. */
export function createLiveScheduler({
  collectors,
  repository,
  now = Date.now,
  timers = globalThis,
  onChange = () => {},
}) {
  let stopped = false
  let running = false
  const restored = repository.snapshot?.().records ?? []
  const lanes = Object.fromEntries(
    LIVE_KINDS.map((kind) => {
      const previous = restored.findLast((record) => record.kind === kind)
      return [
        kind,
        {
          phase: previous ? 'ready' : 'idle',
          lastSuccessAt: previous?.receivedAt ?? null,
          nextRunAt: null,
          error: null,
        },
      ]
    }),
  )
  const active = new Map()
  const handles = new Map()
  const failures = new Map()
  const paused = new Set()
  const snapshot = () => structuredClone(lanes)

  function schedule(kind) {
    if (stopped || paused.has(kind)) return
    const delay = Math.min(900000, LIVE_INTERVALS[kind] * 2 ** Math.min(4, Math.max(0, (failures.get(kind) || 0) - 1)))
    lanes[kind].nextRunAt = iso(now() + delay)
    handles.set(
      kind,
      timers.setTimeout(() => {
        handles.delete(kind)
        void run(kind, true)
      }, delay),
    )
  }

  function run(kind, repeat = false) {
    if (active.has(kind)) return active.get(kind)
    if (stopped) return Promise.resolve()
    lanes[kind] = { ...lanes[kind], phase: 'collecting', nextRunAt: null, error: null }
    onChange(snapshot())
    const task = (async () => {
      try {
        const path = await Promise.resolve().then(() => collectors[kind]())
        if (stopped) return
        await repository.append(kind, path)
        lanes[kind] = { ...lanes[kind], phase: 'ready', lastSuccessAt: iso(now()), error: null }
        failures.set(kind, 0)
      } catch (error) {
        if (error?.code === 'ARCHIVE_QUOTA') paused.add(kind)
        failures.set(kind, (failures.get(kind) || 0) + 1)
        lanes[kind] = { ...lanes[kind], phase: 'error', error: safeCollectionError(error) }
      } finally {
        active.delete(kind)
        if (repeat) schedule(kind)
        onChange(snapshot())
      }
    })()
    active.set(kind, task)
    return task
  }

  return {
    snapshot,
    async start({ once = false } = {}) {
      if (running) return
      running = true
      stopped = false
      await Promise.all(LIVE_KINDS.map((kind) => run(kind, !once)))
    },
    stop() {
      stopped = true
      collectors.stop?.()
      for (const handle of handles.values()) timers.clearTimeout(handle)
      handles.clear()
      for (const lane of Object.values(lanes)) lane.nextRunAt = null
    },
    async settled() {
      await Promise.all([...active.values()])
    },
  }
}
