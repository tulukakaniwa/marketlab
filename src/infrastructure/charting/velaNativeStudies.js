import { getNativeIndicator, registerNativeIndicator } from '@luxalgo/vela/plugin'
import { waitForChartOperation } from './chartOperation.js'

const PROFILE_INPUTS = { rows: 36, valueAreaPct: 70, widthPct: 26, showPoc: true }
const volumeHooks = new Map()
const originalDescriptors = new WeakMap()
const originalProfileDescriptors = new WeakMap()

/** Native factories are global, while their context's public DataControl identifies a chart. */
function installVolumeHooks() {
  const descriptor = getNativeIndicator('volume')
  if (!descriptor) throw new Error('Vela 原生成交量未注册')
  if (originalDescriptors.has(descriptor)) return
  const wrapped = {
    ...descriptor,
    create() {
      const native = descriptor.create()
      let context, hooks
      function emit(out = {}) {
        context?.emit(hooks ? { ...out, backgrounds: hooks.bands() } : out)
      }
      return {
        start(value, inputs) {
          context = value
          hooks = volumeHooks.get(value.data)
          native.start({ ...value, emit }, inputs)
        },
        onBars: (...args) => native.onBars?.(...args),
        onViewport: (...args) => native.onViewport?.(...args),
        setInputs(inputs) {
          native.setInputs(inputs)
          if (hooks) emit()
        },
        suspend: () => native.suspend?.(),
        resume() {
          native.resume?.()
          if (hooks) emit()
        },
        stop() {
          context = hooks = null
          native.stop()
        },
      }
    },
  }
  originalDescriptors.set(wrapped, descriptor)
  registerNativeIndicator(wrapped)
}

function releaseVolumeHooks(data) {
  volumeHooks.delete(data)
  if (volumeHooks.size) return
  const current = getNativeIndicator('volume')
  const original = current && originalDescriptors.get(current)
  if (original) registerNativeIndicator(original)
  const profile = getNativeIndicator('vpvr')
  const originalProfile = profile && originalProfileDescriptors.get(profile)
  if (originalProfile) registerNativeIndicator(originalProfile)
}

/** Native rendering and lifecycle only; regime bands arrive from the domain query. */
export function createVelaNativeStudies({
  chart,
  signal,
  onOverlayChange,
  onError,
  runSilent = (command) => command(),
} = {}) {
  const records = { volume: null, vpvr: null }
  let desired = {},
    generation = 0,
    internal = 0,
    destroyed = false
  const off = []

  function mutate(command) {
    internal++
    try {
      return runSilent(command)
    } finally {
      internal--
    }
  }
  function assertLive() {
    if (destroyed || signal?.aborted) throw new DOMException('图表初始化已取消', 'AbortError')
  }
  function paneFor(record) {
    return record?.handle
      ? (chart.panes.list().find((pane) => pane.indicators.some(({ id }) => id === record.handle.id)) ?? null)
      : null
  }
  function remove(type) {
    const record = records[type]
    if (!record) return
    records[type] = null
    record.controller.abort()
    mutate(() => record.handle?.remove())
  }

  function ensure(type) {
    if (records[type]) return records[type]
    const existing = chart.indicators?.().find((handle) => handle.nativeType === type)
    if (existing) return adopt(type, existing)
    const record = { handle: null, controller: new AbortController(), placed: false, lastBands: '', userHidden: false }
    records[type] = record
    try {
      record.handle = mutate(() =>
        chart.addNativeIndicator(type, {
          inputs: type === 'volume' ? { upColor: '#0e7558', downColor: '#a93226' } : PROFILE_INPUTS,
        }),
      )
      record.ready = whenReady(record)
      return record
    } catch (error) {
      records[type] = null
      record.controller.abort()
      throw error
    }
  }

  function bands() {
    return (desired.volumeBackgrounds ?? []).map((band) => ({ ...band }))
  }

  function adopt(type, handle) {
    if (records[type]?.handle === handle) return records[type]
    const record = { handle, controller: new AbortController(), placed: false, lastBands: '', userHidden: false }
    records[type] = record
    record.ready = whenReady(record)
    return record
  }

  function whenReady(record) {
    if (paneFor(record)) return Promise.resolve()
    const unsubscribers = []
    const operation = new Promise((resolve, reject) => {
      unsubscribers.push(record.handle.on('ready', resolve))
      unsubscribers.push(record.handle.on('error', ({ error }) => reject(error)))
    })
    return waitForChartOperation(operation, { signal: record.controller.signal, label: 'Vela 原生指标' }).finally(
      () => {
        unsubscribers.forEach((unsubscribe) => unsubscribe())
      },
    )
  }

  async function reconcile(type, ticket) {
    const enabled = type === 'volume' ? desired.volume : desired.profile
    if (!enabled) return
    const record = ensure(type)
    try {
      await record.ready
    } catch (error) {
      if (records[type] !== record && !destroyed && !signal?.aborted) return
      throw error
    }
    assertLive()
    if (ticket !== generation || records[type] !== record) return
    if (record.userHidden) {
      record.userHidden = false
      mutate(() => record.handle.setVisible(type !== 'vpvr' || desired.profilePaintEnabled !== false))
    }
    if (type === 'volume') {
      if (!record.placed) {
        mutate(() => record.handle.moveTo({ newPane: { after: 'price' } }))
        record.placed = true
      }
      const signature = JSON.stringify(desired.volumeBackgrounds ?? [])
      if (signature !== record.lastBands) {
        // Vela value patches omit backgrounds; an input command triggers its structural mount.
        mutate(() => record.handle.setInputs({}))
        record.lastBands = signature
      }
    } else {
      mutate(() => {
        record.handle.moveTo('price')
        record.handle.setVisible(desired.profilePaintEnabled !== false)
      })
    }
  }

  async function sync(next) {
    assertLive()
    desired = { ...next }
    const ticket = ++generation
    if (!desired.volume && !records.volume?.userHidden) remove('volume')
    if (!desired.profile && !records.vpvr?.userHidden) remove('vpvr')
    await Promise.all([reconcile('volume', ticket), reconcile('vpvr', ticket)])
  }

  function find(id) {
    return Object.entries(records).find(([, record]) => record?.handle?.id === id)
  }
  installVolumeHooks()
  const profile = getNativeIndicator('vpvr')
  if (profile && !originalProfileDescriptors.has(profile)) {
    const labeled = {
      ...profile,
      shortTitle: 'VRVP · OHLCV代理',
      defaultInputs: () => ({ ...profile.defaultInputs?.(), ...PROFILE_INPUTS }),
    }
    originalProfileDescriptors.set(labeled, profile)
    registerNativeIndicator(labeled)
  }
  volumeHooks.set(chart.data, { bands })
  off.push(
    chart.on('indicator:added', ({ id }) => {
      if (destroyed || internal) return
      const handle = chart.indicators?.().find((handle) => handle.id === id)
      if (!handle || !Object.hasOwn(records, handle.nativeType)) return
      // Our deferred first emit announces after the add command's mute has ended.
      // Existing managed records are already tracked, so this is only a user add/undo.
      if (records[handle.nativeType]?.handle === handle) return
      adopt(handle.nativeType, handle)
      const key = handle.nativeType === 'volume' ? 'volume' : 'stockChipProfile'
      desired = { ...desired, [handle.nativeType === 'volume' ? 'volume' : 'profile']: true }
      onOverlayChange?.(key, true)
      void reconcile(handle.nativeType, generation).catch((error) => {
        if (!destroyed) onError?.(error)
      })
    }),
  )
  off.push(
    chart.on('indicator:removed', ({ id }) => {
      const found = find(id)
      if (!found) return
      const [type, record] = found
      records[type] = null
      record.controller.abort()
      if (!internal) onOverlayChange?.(type === 'volume' ? 'volume' : 'stockChipProfile', false)
    }),
  )
  off.push(
    chart.on('indicator:visibility', ({ id, visible }) => {
      const found = find(id)
      if (found?.[0] === 'vpvr' && visible && desired.profilePaintEnabled === false && !internal) {
        mutate(() => found[1].handle.setVisible(false))
        return
      }
      if (found && !internal) {
        found[1].userHidden = !visible
        onOverlayChange?.(found[0] === 'volume' ? 'volume' : 'stockChipProfile', visible)
      }
    }),
  )
  off.push(
    chart.on('indicator:moved', ({ id, paneId }) => {
      if (id === records.vpvr?.handle?.id && paneId !== 'price') mutate(() => records.vpvr.handle.moveTo('price'))
    }),
  )

  function destroy() {
    if (destroyed) return
    destroyed = true
    generation++
    signal?.removeEventListener('abort', destroy)
    off.forEach((unsubscribe) => unsubscribe())
    Object.values(records).forEach((record) => record?.controller.abort())
    records.volume = records.vpvr = null
    releaseVolumeHooks(chart.data)
  }
  if (signal?.aborted) destroy()
  else signal?.addEventListener('abort', destroy, { once: true })

  return {
    sync,
    destroy,
    get volumeHandle() {
      return records.volume?.handle ?? null
    },
    get profileHandle() {
      return records.vpvr?.handle ?? null
    },
    getVolumePane: () => paneFor(records.volume),
  }
}
