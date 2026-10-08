import { ref } from 'vue'
import {
  LEGACY_DRAWING_STORAGE_KEY,
  VELA_DRAWING_STORAGE_KEY,
  migrateLegacyDrawings,
  readDrawingLibrary,
} from '../infrastructure/charting/velaDrawingPersistence.js'

/** Host scope/storage commands only. Geometry, gestures and history belong to Vela. */
export function useVelaDrawings({ getAdapter, getScope, getAnchorTime, storage }) {
  if (!storage) {
    try {
      storage = window.localStorage
    } catch {
      /* Storage access can be disabled by the browser. */
    }
  }
  const canUndo = ref(false),
    canRedo = ref(false),
    count = ref(0)
  let scope = '',
    loading = false,
    attached = false,
    pending = false
  const subscriptions = []

  function refresh() {
    const drawings = getAdapter()?.chart.drawings
    canUndo.value = drawings?.canUndo() ?? false
    canRedo.value = drawings?.canRedo() ?? false
    count.value = drawings?.all().length ?? 0
  }

  function persist() {
    pending = false
    if (loading || !attached || !scope) return
    refresh()
    try {
      const library = readDrawingLibrary(storage, VELA_DRAWING_STORAGE_KEY)
      // Spread defines even special object keys as ordinary own properties.
      library.byScope = { ...library.byScope, [scope]: getAdapter().exportDrawings() }
      storage.setItem(VELA_DRAWING_STORAGE_KEY, JSON.stringify(library))
    } catch {
      // Storage may be unavailable/full; retain the live native drawing document.
    }
  }

  function changed() {
    if (loading) return
    refresh()
    if (pending) return
    pending = true
    queueMicrotask(() => {
      if (pending) persist()
    })
  }

  function loadScope() {
    const next = typeof getScope() === 'string' ? getScope().trim() : ''
    if (!attached || (scope === next && !loading)) return
    if (scope) persist()
    scope = next
    loading = true
    try {
      const library = readDrawingLibrary(storage, VELA_DRAWING_STORAGE_KEY)
      const legacy = readDrawingLibrary(storage, LEGACY_DRAWING_STORAGE_KEY)
      const document = Object.hasOwn(library.byScope, scope)
        ? library.byScope[scope]
        : migrateLegacyDrawings(Object.hasOwn(legacy.byScope, scope) ? legacy.byScope[scope] : [], getAnchorTime())
      getAdapter().chart.drawings.setTool(null)
      getAdapter().importDrawings(document)
    } finally {
      loading = false
      refresh()
      persist()
    }
  }

  function attach() {
    if (attached) return
    attached = true
    // Undo/redo restore a snapshot and announce selection, without edited/removed events.
    for (const event of ['drawing:created', 'drawing:edited', 'drawing:removed', 'drawing:selected'])
      subscriptions.push(getAdapter().chart.on(event, changed))
    loading = true
    loadScope()
  }

  function dispose() {
    persist()
    attached = false
    for (const unsubscribe of subscriptions) unsubscribe()
    subscriptions.length = 0
  }

  function undo() {
    getAdapter()?.chart.drawings.undo()
    changed()
  }
  function redo() {
    getAdapter()?.chart.drawings.redo()
    changed()
  }
  return { canUndo, canRedo, count, refresh, attach, loadScope, dispose, undo, redo }
}
