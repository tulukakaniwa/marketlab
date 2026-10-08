/** Read-only validation of the saved pre-Vela drawing format. */
export const CHART_DRAWING_VERSION = 1
export const CHART_DRAWING_TYPES = Object.freeze(['horizontal', 'trend', 'range'])

export function sanitizeDrawing(value) {
  if (!value || typeof value !== 'object') return null
  const id = sanitizeId(value.id)
  if (!id || !CHART_DRAWING_TYPES.includes(value.type)) return null

  if (value.type === 'horizontal') {
    const price = finitePositive(value.price)
    return price === null ? null : { id, type: value.type, price }
  }

  const start = sanitizeAnchor(value.start)
  const end = sanitizeAnchor(value.end)
  return start && end ? { id, type: value.type, start, end } : null
}

export function sanitizeDrawings(values, limit = 80) {
  if (!Array.isArray(values)) return []
  const out = []
  const ids = new Set()
  for (const value of values) {
    const drawing = sanitizeDrawing(value)
    if (!drawing || ids.has(drawing.id)) continue
    ids.add(drawing.id)
    out.push(drawing)
    if (out.length >= limit) break
  }
  return out
}

export function normalizeChartTime(value) {
  if (Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 40)
  if (value && Number.isInteger(value.year) && Number.isInteger(value.month) && Number.isInteger(value.day)) {
    return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`
  }
  return null
}

function sanitizeAnchor(value) {
  const time = normalizeChartTime(value?.time)
  const price = finitePositive(value?.price)
  return time === null || price === null ? null : { time, price }
}

function sanitizeId(value) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : ''
}

function finitePositive(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}
