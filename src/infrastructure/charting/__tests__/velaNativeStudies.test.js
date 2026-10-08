import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createVelaNativeStudies } from '../velaNativeStudies.js'

const state = vi.hoisted(() => ({ catalog: new Map() }))
vi.mock('@luxalgo/vela/plugin', () => ({
  getNativeIndicator: (type) => state.catalog.get(type),
  registerNativeIndicator: (descriptor) => state.catalog.set(descriptor.type, descriptor),
}))

function emitter() {
  const events = new Map()
  return {
    on(event, handler) {
      if (!events.has(event)) events.set(event, new Set())
      events.get(event).add(handler)
      return () => events.get(event).delete(handler)
    },
    emit(event, payload) {
      for (const handler of events.get(event) ?? []) handler(payload)
    },
    listeners: () => [...events.values()].reduce((total, handlers) => total + handlers.size, 0),
  }
}

function descriptor(type) {
  return {
    type,
    title: type,
    defaultInputs: () => ({}),
    create: () => {
      let context
      return {
        start(value) {
          context = value
          context.emit({})
          context.pushData({ native: type })
        },
        setInputs: vi.fn(() => context?.pushData({ native: type })),
        onBars() {},
        onViewport() {},
        suspend() {},
        resume: () => context?.pushData({ native: type }),
        stop: vi.fn(),
      }
    },
  }
}

function mockChart({ autoStart = true } = {}) {
  const events = emitter()
  const handles = new Map()
  let sequence = 0
  const chart = {
    ...events,
    data: {},
    handles,
    indicators: () => [...handles.values()],
    panes: {
      list: () => {
        const panes = new Map([['price', { id: 'price', indicators: [] }]])
        for (const handle of handles.values()) {
          if (!handle.mounted) continue
          if (!panes.has(handle.pane)) panes.set(handle.pane, { id: handle.pane, indicators: [] })
          panes.get(handle.pane).indicators.push({ id: handle.id })
        }
        return [...panes.values()]
      },
    },
    addNativeIndicator: vi.fn((type, { inputs = {} } = {}) => {
      const existing = [...handles.values()].find((handle) => handle.nativeType === type)
      if (existing) return existing
      const contribution = state.catalog.get(type)
      const native = contribution.create()
      const handleEvents = emitter()
      const handle = {
        ...handleEvents,
        id: `${type}-${++sequence}`,
        nativeType: type,
        native,
        contribution,
        pane: 'price',
        visible: true,
        inputs: { ...inputs },
        output: null,
        mounted: false,
        moveTo: vi.fn((target) => {
          if (!handle.mounted) return
          handle.pane = target === 'price' ? 'price' : (target.pane ?? `pane-${handle.id}`)
          events.emit('indicator:moved', { id: handle.id, paneId: handle.pane })
        }),
        setInputs: vi.fn((values) => {
          handle.inputs = { ...handle.inputs, ...values }
          native.setInputs(handle.inputs)
        }),
        setVisible: vi.fn((visible) => {
          if (handle.visible === visible) return
          handle.visible = visible
          events.emit('indicator:visibility', { id: handle.id, visible })
        }),
        remove: vi.fn(() => {
          native.stop()
          handles.delete(handle.id)
          events.emit('indicator:removed', { id: handle.id })
        }),
      }
      handle.context = {
        id: handle.id,
        data: chart.data,
        pushData: vi.fn(),
        emit: vi.fn((out) => {
          handle.output = out
          if (!handle.mounted) {
            handle.mounted = true
            events.emit('indicator:added', { id: handle.id })
            handleEvents.emit('ready')
          }
        }),
      }
      handles.set(handle.id, handle)
      if (autoStart) void Promise.resolve().then(() => chart.start(handle))
      return handle
    }),
    start: (handle) => handle.native.start(handle.context, handle.inputs),
  }
  return chart
}

beforeEach(() => {
  state.catalog.clear()
  state.catalog.set('volume', descriptor('volume'))
  state.catalog.set('vpvr', descriptor('vpvr'))
})

const firstBand = { id: 'regime-1', paneId: '', from: 1, to: 2, color: '#123' }

describe('Vela native studies', () => {
  it('waits for native volume output before moving, keeps native type and augments backgrounds without a histogram', async () => {
    const chart = mockChart({ autoStart: false })
    const original = state.catalog.get('volume')
    const studies = createVelaNativeStudies({ chart })
    const pending = studies.sync({ volume: true, profile: false, volumeBackgrounds: [firstBand] })
    const handle = studies.volumeHandle
    expect(state.catalog.get('volume')).not.toBe(original)
    expect(handle.nativeType).toBe('volume')
    expect(handle.moveTo).not.toHaveBeenCalled()
    chart.start(handle)
    await pending
    expect(handle.moveTo).toHaveBeenCalledWith({ newPane: { after: 'price' } })
    expect(studies.getVolumePane()).toMatchObject({ id: `pane-${handle.id}` })
    expect(handle.output).toEqual({ backgrounds: [firstBand] })
    expect(handle.output.backgrounds[0]).not.toBe(firstBand)
    expect(handle.output.series).toBeUndefined()
    const newBand = { ...firstBand, color: '#789' }
    handle.setInputs({ heightPct: 33 })
    await studies.sync({ volume: true, volumeBackgrounds: [newBand] })
    expect(handle.output.backgrounds).toEqual([newBand])
    expect(handle.inputs.heightPct).toBe(33)
    expect(chart.addNativeIndicator).toHaveBeenCalledOnce()
    const calls = handle.setInputs.mock.calls.length
    await studies.sync({ volume: true, volumeBackgrounds: [newBand] })
    expect(handle.setInputs.mock.calls).toHaveLength(calls)
    studies.destroy()
    expect(state.catalog.get('volume')).toBe(original)
    expect(chart.listeners()).toBe(0)
    expect(handle.remove).not.toHaveBeenCalled()
  })

  it('uses 36 rows and 70 percent value area, gates mobile painting without changing the profile preference', async () => {
    const chart = mockChart()
    const onOverlayChange = vi.fn()
    const studies = createVelaNativeStudies({ chart, onOverlayChange })
    await studies.sync({ profile: true, profilePaintEnabled: true })
    const handle = studies.profileHandle
    expect(handle.inputs).toEqual({ rows: 36, valueAreaPct: 70, widthPct: 26, showPoc: true })
    handle.setInputs({ rows: 50 })
    await studies.sync({ profile: true, profilePaintEnabled: false })
    expect(handle.visible).toBe(false)
    handle.setVisible(true)
    expect(handle.visible).toBe(false)
    expect(handle.inputs.rows).toBe(50)
    expect(onOverlayChange).not.toHaveBeenCalled()
    await studies.sync({ profile: true, profilePaintEnabled: true })
    expect(studies.profileHandle).toBe(handle)
    expect(handle.visible).toBe(true)
    expect(handle.inputs.rows).toBe(50)
    expect(onOverlayChange).not.toHaveBeenCalled()
    handle.moveTo({ newPane: true })
    expect(handle.pane).toBe('price')
    handle.setVisible(false)
    expect(onOverlayChange).toHaveBeenLastCalledWith('stockChipProfile', false)
    studies.destroy()
  })

  it('keeps the native eye control usable across a host sync and restores the same handle', async () => {
    const chart = mockChart()
    const onOverlayChange = vi.fn()
    const studies = createVelaNativeStudies({ chart, onOverlayChange })
    await studies.sync({ volume: true, volumeBackgrounds: [firstBand] })
    const old = studies.volumeHandle
    old.setVisible(false)
    expect(onOverlayChange).toHaveBeenCalledWith('volume', false)
    await studies.sync({ volume: false })
    expect(old.remove).not.toHaveBeenCalled()
    expect(studies.volumeHandle).toBe(old)
    expect(old.visible).toBe(false)
    expect(studies.getVolumePane()).not.toBeNull()
    old.setVisible(true)
    expect(onOverlayChange).toHaveBeenLastCalledWith('volume', true)
    await studies.sync({ volume: true, volumeBackgrounds: [firstBand] })
    const restored = studies.volumeHandle
    expect(restored).toBe(old)
    expect(restored.visible).toBe(true)
    expect(restored.mounted).toBe(true)
    expect(restored.context.pushData).toHaveBeenCalledWith({ native: 'volume' })
    expect(restored.output.backgrounds).toEqual([firstBand])
    expect(studies.getVolumePane()).not.toBeNull()
    expect(chart.addNativeIndicator).toHaveBeenCalledOnce()
    expect(onOverlayChange).toHaveBeenCalledTimes(2)
    studies.destroy()
  })

  it('restores a natively hidden handle from the host checkbox and removes it when the host disables it', async () => {
    const chart = mockChart()
    const studies = createVelaNativeStudies({ chart })
    await studies.sync({ volume: true, profile: true })
    const volume = studies.volumeHandle,
      profile = studies.profileHandle
    volume.setVisible(false)
    profile.setVisible(false)
    await studies.sync({ volume: false, profile: false })
    expect(studies.volumeHandle).toBe(volume)
    expect(studies.profileHandle).toBe(profile)
    await studies.sync({ volume: true, profile: true })
    expect(volume.visible).toBe(true)
    expect(profile.visible).toBe(true)
    await studies.sync({ volume: false, profile: false })
    expect(volume.remove).toHaveBeenCalledOnce()
    expect(profile.remove).toHaveBeenCalledOnce()
    expect(studies.volumeHandle).toBeNull()
    expect(studies.profileHandle).toBeNull()
    studies.destroy()
  })

  it('invalidates externally removed handles and lets an explicit re-enable create a fresh native', async () => {
    const chart = mockChart()
    const onOverlayChange = vi.fn()
    const studies = createVelaNativeStudies({ chart, onOverlayChange })
    await studies.sync({ volume: true, profile: true })
    const volume = studies.volumeHandle
    volume.remove()
    expect(studies.volumeHandle).toBeNull()
    expect(onOverlayChange).toHaveBeenCalledWith('volume', false)
    await studies.sync({ volume: false, profile: false })
    expect(studies.profileHandle).toBeNull()
    expect(onOverlayChange).toHaveBeenCalledOnce()
    await studies.sync({ volume: true })
    expect(studies.volumeHandle).not.toBe(volume)
    expect(studies.getVolumePane()).not.toBeNull()
    studies.destroy()
  })

  it('restores the global native descriptor when native add throws', async () => {
    const chart = mockChart()
    const original = state.catalog.get('volume')
    chart.addNativeIndicator.mockImplementationOnce(() => {
      throw new Error('native mount failed')
    })
    const studies = createVelaNativeStudies({ chart })
    await expect(studies.sync({ volume: true })).rejects.toThrow('native mount failed')
    expect(state.catalog.get('volume')).not.toBe(original)
    expect(studies.volumeHandle).toBeNull()
    studies.destroy()
    expect(state.catalog.get('volume')).toBe(original)
  })

  it('aborts pending native startup and releases every listener without destroying the chart', async () => {
    const chart = mockChart({ autoStart: false })
    const controller = new AbortController()
    const studies = createVelaNativeStudies({ chart, signal: controller.signal })
    const pending = studies.sync({ volume: true, profile: true })
    const handles = [...chart.handles.values()]
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(chart.listeners()).toBe(0)
    expect(handles.every((handle) => handle.listeners() === 0)).toBe(true)
    expect(handles.every((handle) => handle.remove.mock.calls.length === 0)).toBe(true)
    await expect(studies.sync({ volume: true })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not resurrect a study disabled during async startup or report internal removals as user commands', async () => {
    const chart = mockChart({ autoStart: false })
    const onOverlayChange = vi.fn()
    const studies = createVelaNativeStudies({ chart, onOverlayChange })
    const pending = studies.sync({ volume: true })
    const old = studies.volumeHandle
    await studies.sync({ volume: false })
    await pending
    expect(studies.volumeHandle).toBeNull()
    expect(old.moveTo).not.toHaveBeenCalled()
    expect(old.listeners()).toBe(0)
    expect(onOverlayChange).not.toHaveBeenCalled()
    studies.destroy()
  })

  it('adopts native picker additions and undo restorations without replacing their handles or settings', async () => {
    const chart = mockChart({ autoStart: false })
    const onOverlayChange = vi.fn()
    const studies = createVelaNativeStudies({ chart, onOverlayChange })
    await studies.sync({ volume: false, profile: false, volumeBackgrounds: [firstBand] })
    const external = chart.addNativeIndicator('volume', { inputs: { heightPct: 33 } })
    chart.start(external)
    await Promise.resolve()
    expect(studies.volumeHandle).toBe(external)
    expect(onOverlayChange).toHaveBeenLastCalledWith('volume', true)
    expect(external.pane).toBe(`pane-${external.id}`)
    expect(external.output.backgrounds).toEqual([firstBand])
    await studies.sync({ volume: true, volumeBackgrounds: [firstBand] })
    expect(external.inputs.heightPct).toBe(33)
    expect(chart.addNativeIndicator).toHaveBeenCalledOnce()
    external.setVisible(false)
    expect(onOverlayChange).toHaveBeenLastCalledWith('volume', false)
    external.remove()
    expect(studies.volumeHandle).toBeNull()
    // The workspace's undo re-adds the native through its original public action.
    const restored = chart.addNativeIndicator('volume', { inputs: { heightPct: 42 } })
    chart.start(restored)
    await Promise.resolve()
    expect(studies.volumeHandle).toBe(restored)
    expect(restored.output.backgrounds).toEqual([firstBand])
    expect(restored.inputs.heightPct).toBe(42)
    studies.destroy()
  })

  it('keeps shared native factories isolated across registered and uncontrolled charts', async () => {
    const first = mockChart(),
      second = mockChart(),
      uncontrolled = mockChart()
    const original = state.catalog.get('volume')
    const firstStudies = createVelaNativeStudies({ chart: first })
    const secondStudies = createVelaNativeStudies({ chart: second })
    const secondBand = { ...firstBand, id: 'second', color: '#abc' }
    await firstStudies.sync({ volume: true, volumeBackgrounds: [firstBand] })
    await secondStudies.sync({ volume: true, volumeBackgrounds: [secondBand] })
    const external = uncontrolled.addNativeIndicator('volume')
    await Promise.resolve()
    expect(firstStudies.volumeHandle.output.backgrounds).toEqual([firstBand])
    expect(secondStudies.volumeHandle.output.backgrounds).toEqual([secondBand])
    expect(external.output).toEqual({})
    firstStudies.destroy()
    expect(state.catalog.get('volume')).not.toBe(original)
    const nextBand = { ...secondBand, color: '#def' }
    await secondStudies.sync({ volume: true, volumeBackgrounds: [nextBand] })
    expect(secondStudies.volumeHandle.output.backgrounds).toEqual([nextBand])
    secondStudies.destroy()
    expect(state.catalog.get('volume')).toBe(original)
  })

  it('adopts a picker profile, adds its source to the native legend, and keeps mobile painting gated', async () => {
    const chart = mockChart({ autoStart: false })
    const original = state.catalog.get('vpvr')
    const onOverlayChange = vi.fn()
    const studies = createVelaNativeStudies({ chart, onOverlayChange })
    await studies.sync({ profile: false, profilePaintEnabled: false })
    const external = chart.addNativeIndicator('vpvr', { inputs: { rows: 64 } })
    chart.start(external)
    await Promise.resolve()
    expect(studies.profileHandle).toBe(external)
    expect(external.contribution.shortTitle).toBe('VRVP · OHLCV代理')
    expect(external.visible).toBe(false)
    expect(onOverlayChange).toHaveBeenLastCalledWith('stockChipProfile', true)
    external.setVisible(true)
    expect(external.visible).toBe(false)
    await studies.sync({ profile: true, profilePaintEnabled: true })
    expect(external.visible).toBe(true)
    expect(external.inputs.rows).toBe(64)
    studies.destroy()
    expect(state.catalog.get('vpvr')).toBe(original)
  })

  it('reinstalls hooks after a new Vela constructor registers builtins without changing existing instance hooks', async () => {
    const first = mockChart()
    const firstStudies = createVelaNativeStudies({ chart: first })
    await firstStudies.sync({ volume: true, volumeBackgrounds: [firstBand] })
    // A new Vela constructor re-registers the builtin catalog before its helper starts.
    const latestVolume = descriptor('volume')
    state.catalog.set('volume', latestVolume)
    state.catalog.set('vpvr', descriptor('vpvr'))
    const second = mockChart()
    const secondStudies = createVelaNativeStudies({ chart: second })
    const nextBand = { ...firstBand, id: 'second', color: '#def' }
    await secondStudies.sync({ volume: true, volumeBackgrounds: [nextBand] })
    await firstStudies.sync({ volume: true, volumeBackgrounds: [{ ...firstBand, color: '#789' }] })
    expect(firstStudies.volumeHandle.output.backgrounds).toEqual([{ ...firstBand, color: '#789' }])
    expect(secondStudies.volumeHandle.output.backgrounds).toEqual([nextBand])
    firstStudies.destroy()
    expect(state.catalog.get('volume')).not.toBe(latestVolume)
    secondStudies.destroy()
    expect(state.catalog.get('volume')).toBe(latestVolume)
  })

  it('runs every host native mutation through the injected workspace history mute', async () => {
    const chart = mockChart()
    let muted = false
    const hostAdds = [],
      hostRemoves = []
    const nativeAdd = chart.addNativeIndicator.getMockImplementation()
    chart.addNativeIndicator.mockImplementation((...args) => {
      hostAdds.push(muted)
      return nativeAdd(...args)
    })
    const runSilent = vi.fn((command) => {
      muted = true
      try {
        return command()
      } finally {
        muted = false
      }
    })
    const studies = createVelaNativeStudies({ chart, runSilent })
    await studies.sync({ volume: true, profile: true, volumeBackgrounds: [firstBand] })
    const volume = studies.volumeHandle,
      profile = studies.profileHandle
    for (const handle of [volume, profile]) {
      const remove = handle.remove.getMockImplementation()
      handle.remove.mockImplementation(() => {
        hostRemoves.push(muted)
        return remove()
      })
    }
    await studies.sync({ volume: true, profile: true, profilePaintEnabled: false, volumeBackgrounds: [] })
    await studies.sync({ volume: false, profile: false })
    expect(hostAdds).toEqual([true, true])
    expect(hostRemoves).toEqual([true, true])
    expect(runSilent.mock.calls.length).toBeGreaterThanOrEqual(8)
    studies.destroy()
  })
})
