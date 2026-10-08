import {
  registerNativeIndicator,
  unregisterNativeIndicator,
  registerRendererLayer,
  unregisterRendererLayer,
} from '@luxalgo/vela/plugin'
import { buildVelaResearchGroups, buildVelaHostOutput, toVelaTime } from './velaResearchAdapter.js'
import { waitForChartOperation } from './chartOperation.js'
import { mapDrawingPanes } from './velaDrawingPersistence.js'
import { createVelaNativeStudies } from './velaNativeStudies.js'
import { createVelaWorkspaceShell } from './velaWorkspaceShell.js'

let sequence = 0

/** View adapter only: native indicators consume domain query results, never run formulas. */
export async function createVelaChartAdapter({
  element,
  rows,
  source,
  theme,
  onCursor,
  onOverlayChange,
  onError,
  signal,
}) {
  const prefix = `market-lab-${++sequence}`
  const hostType = `${prefix}-host`
  const records = new Map()
  // Keep native types available until teardown: the shell's undo/picker can restore them.
  const registered = new Map()
  const subscriptions = []
  let chart,
    shell,
    hostContext,
    destroyed = false,
    studies = null,
    internal = 0,
    syncGeneration = 0,
    latestSync = Promise.resolve()
  let frameSequence = 0
  const paneKeys = new Map([['price', 'price']])
  let unsubscribe = null
  let resolvePaint
  const painted = new Promise((resolve) => {
    resolvePaint = resolve
  })

  registerRendererLayer({
    id: hostType,
    placement: 'above-data',
    create() {
      let canvas
      return {
        mount(value) {
          canvas = value
        },
        render(args) {
          if (destroyed || !args.data) return
          const context = canvas.getContext('2d')
          context.setTransform(1, 0, 0, 1, 0, 0)
          context.clearRect(0, 0, canvas.width, canvas.height)
          resolvePaint(true)
        },
      }
    },
  })

  function rememberPanes() {
    for (const [key, record] of records) {
      const pane = chart.panes.list().find((pane) => pane.indicators.some(({ id }) => id === record.handle?.id))
      if (pane && pane.id !== 'price') paneKeys.set(pane.id, `lab:${key}`)
    }
    const volumePane = studies?.getVolumePane()
    if (volumePane) paneKeys.set(volumePane.id, 'lab:volume')
  }

  function mappedDocument(document) {
    const activePanes = new Set(chart.panes.list().map(({ id }) => id))
    const byKey = new Map([...paneKeys].filter(([id]) => activePanes.has(id)).map(([id, key]) => [key, id]))
    return mapDrawingPanes(document, (key) => byKey.get(paneKeys.get(key) ?? key) ?? key)
  }

  function restoreChangedPaneBindings() {
    rememberPanes()
    const previous = chart.drawings.toJSON()
    const next = mappedDocument(previous)
    // Numeric changes and price drawings retain native undo history. A recreated drawn study
    // has no public Vela history-rebind API; restore its geometry only when its pane id changes.
    if (next.drawings.some((drawing, index) => drawing.paneId !== previous.drawings[index]?.paneId))
      chart.drawings.fromJSON(next)
  }

  function mutate(command) {
    internal++
    try {
      return shell ? shell.silently(command) : command()
    } finally {
      internal--
    }
  }

  function ensureRecord(group) {
    let record = records.get(group.id)
    if (record) {
      record.output = group.output
      if (record.userHidden) {
        record.userHidden = false
        mutate(() => record.handle.setVisible(true))
      }
      // Vela's value patch omits markers, backgrounds and series schema. An input command
      // marks the output structural before our native instance emits the domain snapshot.
      if (record.context) mutate(() => record.handle.setInputs({}))
      return record
    }
    record = registered.get(group.id)
    if (record) {
      record.output = group.output
      records.set(group.id, record)
      record.handle = mutate(() => chart.addNativeIndicator(record.type))
      record.offError = record.handle.on('error', ({ error }) => record.rejectStarted?.(error))
      return record
    }
    record = {
      output: group.output,
      context: null,
      handle: null,
      type: `${prefix}-${group.id}`,
      overlayKey: group.overlayKey,
      removed: false,
    }
    records.set(group.id, record)
    registered.set(group.id, record)
    registerNativeIndicator({
      type: record.type,
      title: `Lab · ${group.title}`,
      paneHint: group.overlay ? 'price' : 'new',
      overlay: group.overlay,
      legend: group.id !== 'host',
      isSupported: (_symbol, data) => group.id !== 'host' && data === chart.data,
      inputsSchema: () => [],
      defaultInputs: () => ({}),
      create: () => {
        const controller = new AbortController()
        let resolveStarted
        const started = new Promise((resolve, reject) => {
          resolveStarted = resolve
          record.rejectStarted = reject
        })
        // Restored/hidden native instances may fail outside a host sync wait.
        // Their chart-level error event still reaches the workspace recovery path.
        started.catch(() => {})
        record.controller = controller
        record.removed = false
        // A market refresh creates hidden natives without starting them. Start the
        // bounded wait only when the current query actually needs this indicator.
        record.ready = started
        return {
          start(context) {
            record.context = context
            context.emit(record.output)
            rememberPanes()
            resolveStarted()
            if (group.id === 'host') {
              hostContext = context
              context.pushData({ frame: ++frameSequence })
            }
          },
          onBars() {
            record.context?.emit(record.output)
          },
          onViewport() {},
          setInputs() {
            record.context?.emit(record.output)
          },
          suspend() {},
          resume() {
            record.context?.emit(record.output)
          },
          stop() {
            record.context = null
            if (group.id === 'host') hostContext = null
          },
        }
      },
    })
    record.handle = mutate(() => chart.addNativeIndicator(record.type))
    record.offError = record.handle.on('error', ({ error }) => record.rejectStarted?.(error))
    return record
  }

  function sync(model, input) {
    if (destroyed) return Promise.resolve()
    const generation = ++syncGeneration
    const groups = buildVelaResearchGroups(model, prefix)
    groups.push({ id: 'host', title: '研究标记', overlay: true, output: buildVelaHostOutput(input, prefix) })
    const ids = new Set(groups.map((group) => group.id))
    for (const [id, record] of registered) {
      if (ids.has(id)) continue
      // A native picker/Undo must never resurrect a prior source's cached values.
      record.output = {
        ...record.output,
        series: record.output.series.map((series) => ({
          ...series,
          points: model.dates.map((date) => ({ time: toVelaTime(date), value: null })),
        })),
      }
    }
    for (const [id, record] of records)
      if (!ids.has(id) && !record.userHidden) {
        record.removed = true
        record.controller.abort()
        record.offError?.()
        mutate(() => record.handle.remove())
        records.delete(id)
      }
    const pending = groups.map((group) => {
      const record = ensureRecord(group)
      const signal = record.controller.signal
      return waitForChartOperation(record.ready, { signal, label: `Vela ${group.title}` }).catch((error) => {
        if (!signal.aborted) throw error
      })
    })
    pending.push(
      studies.sync({
        volume: input.overlays.volume !== false,
        profile: input.overlays.stockChipProfile !== false,
        profilePaintEnabled: input.profilePaintEnabled !== false,
        volumeBackgrounds: buildVelaHostOutput({ ...input, overlays: { regime: true } }, prefix).backgrounds,
      }),
    )
    latestSync = Promise.all(pending).then(() => {
      if (destroyed || generation !== syncGeneration) return
      restoreChangedPaneBindings()
      repaint()
    })
    return latestSync
  }

  async function whenReady() {
    let pending
    do {
      pending = latestSync
      await pending
    } while (pending !== latestSync && !destroyed)
  }

  function repaint() {
    hostContext?.pushData({ frame: ++frameSequence })
  }
  function destroy() {
    if (destroyed) return
    destroyed = true
    resolvePaint(false)
    signal?.removeEventListener('abort', destroy)
    unsubscribe?.()
    subscriptions.forEach((unsubscribe) => unsubscribe())
    studies?.destroy()
    for (const record of registered.values()) {
      record.removed = true
      record.controller?.abort()
      record.offError?.()
    }
    shell?.destroy()
    for (const record of registered.values()) unregisterNativeIndicator(record.type)
    records.clear()
    registered.clear()
    unregisterRendererLayer(hostType)
  }

  try {
    if (signal?.aborted) throw new DOMException('图表初始化已取消', 'AbortError')
    signal?.addEventListener('abort', destroy, { once: true })
    shell = await createVelaWorkspaceShell({ element, rows, source, theme, signal })
    if (destroyed || signal?.aborted) {
      shell.destroy()
      throw new DOMException('图表初始化已取消', 'AbortError')
    }
    chart = shell.chart
    studies = createVelaNativeStudies({
      chart,
      signal,
      onOverlayChange,
      onError,
      runSilent: (command) => shell.silently(command),
    })
    subscriptions.push(
      chart.on('indicator:error', ({ id, error }) => {
        if (destroyed) return
        const handle = chart.indicators().find((handle) => handle.id === id)
        const record = [...registered.values()].find((record) => record.type === handle?.nativeType)
        if (!record && !['volume', 'vpvr'].includes(handle?.nativeType)) return
        record?.rejectStarted?.(error)
        onError?.(error)
      }),
    )
    subscriptions.push(
      chart.on('indicator:added', ({ id }) => {
        if (internal || destroyed) return
        const handle = chart.indicators().find((handle) => handle.id === id)
        const found = [...registered].find(([, record]) => record.type === handle?.nativeType)
        if (!found || found[1].handle?.id === id) return
        const [key, record] = found
        record.offError?.()
        record.handle = handle
        record.userHidden = false
        record.offError = handle.on('error', ({ error }) => record.rejectStarted?.(error))
        records.set(key, record)
        if (record.overlayKey) onOverlayChange?.(record.overlayKey, true)
        record.ready
          .then(() => {
            if (!destroyed) {
              restoreChangedPaneBindings()
              repaint()
            }
          })
          .catch((error) => {
            if (!destroyed) onError?.(error)
          })
      }),
    )
    subscriptions.push(chart.on('indicator:moved', rememberPanes))
    subscriptions.push(
      chart.on('indicator:removed', ({ id }) => {
        if (internal || destroyed) return
        for (const [key, record] of records) {
          if (record.handle?.id !== id) continue
          record.removed = true
          record.controller.abort()
          record.offError?.()
          records.delete(key)
          if (record.overlayKey) onOverlayChange?.(record.overlayKey, false)
        }
      }),
    )
    subscriptions.push(
      chart.on('indicator:visibility', ({ id, visible }) => {
        if (internal || destroyed) return
        const record = [...records.values()].find((record) => record.handle?.id === id)
        if (record?.overlayKey) {
          record.userHidden = !visible
          onOverlayChange?.(record.overlayKey, visible)
        }
      }),
    )
    unsubscribe = chart.renderer.onCrosshairMove(({ time }) => onCursor?.(time))
    return {
      chart,
      sync,
      whenReady,
      repaint,
      destroy,
      painted,
      exportDrawings: () => mapDrawingPanes(chart.drawings.toJSON(), (pane) => paneKeys.get(pane) ?? pane),
      importDrawings: (document) => {
        rememberPanes()
        chart.drawings.fromJSON(mappedDocument(document))
      },
      setRows: shell.setRows,
      setTheme: shell.setTheme,
      resize: shell.resize,
      fit: shell.fit,
    }
  } catch (error) {
    destroy()
    throw error
  }
}
