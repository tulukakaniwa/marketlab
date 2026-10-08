import { sanitizeDrawings } from '../../domain/workbench/legacyChartDrawings.js'
import { toVelaTime } from './velaResearchAdapter.js'

export const VELA_DRAWING_STORAGE_KEY = 'lab.velaDrawings.v1'
export const LEGACY_DRAWING_STORAGE_KEY = 'lab.chartDrawings.v1'

/** One-way migration. The legacy document is deliberately left untouched. */
export function migrateLegacyDrawings(values, anchorTime) {
  return {
    version: 1,
    drawings: sanitizeDrawings(values).flatMap((drawing, index) => {
      const horizontal = drawing.type === 'horizontal'
      const anchors = horizontal
        ? [{ time: anchorTime, price: drawing.price }]
        : [drawing.start, drawing.end].map(({ time, price }) => ({ time: toVelaTime(time), price }))
      if (anchors.some(({ time, price }) => !Number.isFinite(time) || !Number.isFinite(price))) return []
      return [
        {
          id: drawing.id,
          type: horizontal ? 'hline' : drawing.type === 'trend' ? 'trendline' : 'box',
          paneId: 'price',
          anchors,
          style: {
            lineColor: '#0e7558',
            lineWidth: 2,
            lineStyle: 'solid',
            ...(drawing.type === 'range' ? { fillColor: '#0e7558', fillOpacity: 0.08 } : {}),
          },
          locked: false,
          visible: true,
          zIndex: index + 1,
          createdAt: 0,
        },
      ]
    }),
  }
}

/** Persist semantic pane keys, never Vela's per-mount generated pane ids. */
export function mapDrawingPanes(document, mapPane) {
  return {
    version: 1,
    drawings: Array.isArray(document?.drawings)
      ? document.drawings
          .filter((drawing) => drawing && typeof drawing === 'object')
          .map((drawing) => ({ ...drawing, paneId: mapPane(drawing.paneId) }))
      : [],
  }
}

export function readDrawingLibrary(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) ?? 'null')
    return value?.version === 1 && value.byScope && typeof value.byScope === 'object' && !Array.isArray(value.byScope)
      ? value
      : { version: 1, byScope: {} }
  } catch {
    return { version: 1, byScope: {} }
  }
}
