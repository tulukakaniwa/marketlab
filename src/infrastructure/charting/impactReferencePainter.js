const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const colors = {
  lp: { light: '#ad7919', dark: '#efbf65' },
  options: { light: '#7957b1', dark: '#bda0f2' },
}

function project(fn, value) {
  try {
    const coordinate = fn(value)
    return finite(coordinate) ? coordinate : null
  } catch {
    return null
  }
}

function projectPoint(point, projectX, projectY) {
  if (!point || point.status !== 'ready') return null
  const x = project(projectX, point.date)
  if (x === null) return null
  const nodes = new Map()
  for (const node of Array.isArray(point.nodes) ? point.nodes : []) {
    if (
      !node ||
      !Object.hasOwn(colors, node.kind) ||
      !['string', 'number'].includes(typeof node.id) ||
      node.id === '' ||
      !finite(node.price) ||
      node.price <= 0 ||
      !finite(node.intensity) ||
      node.intensity <= 0
    )
      continue
    const y = project(projectY, node.price)
    const key = `${node.kind}:${node.id}`
    if (y === null || nodes.has(key)) continue
    nodes.set(key, { ...node, x, y, intensity: clamp(node.intensity, 0, 1) })
  }
  return { x, nodes }
}

function paintConnections(ctx, points, { left, right }, dark) {
  ctx.lineWidth = 0.8
  ctx.globalAlpha = dark ? 0.35 : 0.28
  ctx.setLineDash([2, 4])
  let previous = null
  for (const point of points) {
    if (point && previous && point.x > previous.x && point.x >= left && previous.x <= right) {
      for (const [key, node] of point.nodes) {
        const prior = previous.nodes.get(key)
        if (!prior) continue
        ctx.strokeStyle = colors[node.kind][dark ? 'dark' : 'light']
        ctx.beginPath()
        ctx.moveTo(prior.x, prior.y)
        ctx.lineTo(node.x, node.y)
        ctx.stroke()
      }
    }
    // A missing row or node breaks continuity. Never search backward or extend a level to another date.
    previous = point
  }
  ctx.setLineDash([])
}

function paintNode(ctx, node, radius, dark) {
  const size = radius * Math.sqrt(node.intensity)
  ctx.fillStyle = colors[node.kind][dark ? 'dark' : 'light']
  ctx.strokeStyle = ctx.fillStyle
  ctx.globalAlpha = 0.3 + node.intensity * 0.5
  ctx.lineWidth = 0.8
  ctx.beginPath()
  if (node.kind === 'lp') {
    ctx.arc(node.x, node.y, size, 0, Math.PI * 2)
  } else {
    // 2*d² equals π*r²: both source shapes have equal area for equal supplied intensity.
    const diagonal = size * Math.sqrt(Math.PI / 2)
    ctx.moveTo(node.x, node.y - diagonal)
    ctx.lineTo(node.x + diagonal, node.y)
    ctx.lineTo(node.x, node.y + diagonal)
    ctx.lineTo(node.x - diagonal, node.y)
    ctx.closePath()
  }
  ctx.fill()
  ctx.stroke()
}

function priceLabel(price) {
  if (price < 0.0001) return price.toPrecision(4)
  return price.toLocaleString('en-US', { maximumFractionDigits: price >= 1000 ? 2 : price >= 1 ? 4 : 8 })
}

function paintLabels(ctx, nodes, pane, radius, dark) {
  ctx.font = '10px system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  let previousBottom = pane.top - 1
  const seen = new Set()
  for (const node of [...nodes].sort((a, b) => a.y - b.y || b.intensity - a.intensity)) {
    const source = node.kind === 'lp' ? 'LP' : '期权'
    const text = `${source} ${priceLabel(node.price)}`
    if (seen.has(text)) continue
    seen.add(text)
    const x = node.x + radius * Math.sqrt(Math.PI / 2) + 6
    const width = ctx.measureText(text).width
    const y = Math.max(pane.top + 7, node.y, previousBottom + 8)
    // Labels use only space after the newest visible observation; never move them onto older candles.
    if (x + width + 3 > pane.right || y + 7 > pane.bottom) continue
    ctx.globalAlpha = dark ? 0.85 : 0.9
    ctx.fillStyle = dark ? '#171b24' : '#ffffff'
    ctx.fillRect(x - 2, y - 7, width + 4, 14)
    ctx.globalAlpha = 1
    ctx.fillStyle = colors[node.kind][dark ? 'dark' : 'light']
    ctx.fillText(text, x, y)
    previousBottom = y + 7
  }
}

/** Paint approved research snapshots only; projection and screen sampling never derive new levels. */
export function paintImpactReferenceMap(
  ctx,
  { snapshot, projectX, projectY, bounds, dark = false, enabled = true, barSpacing = 8 } = {},
) {
  const path = snapshot?.path
  if (
    !enabled ||
    !ctx ||
    !Array.isArray(path) ||
    !path.length ||
    typeof projectX !== 'function' ||
    typeof projectY !== 'function' ||
    !bounds ||
    ![bounds.left, bounds.top, bounds.width, bounds.height].every(finite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return
  const pane = { ...bounds, right: bounds.left + bounds.width, bottom: bounds.top + bounds.height }
  const points = path.map((point) => projectPoint(point, projectX, projectY))
  const spacing = finite(barSpacing) && barSpacing > 0 ? barSpacing : 8
  const radius = clamp(spacing * 0.4, 3, 6)
  const pitch = Math.max(9, radius * Math.sqrt(Math.PI / 2) * 2 + 2)
  ctx.save()
  ctx.beginPath()
  ctx.rect(pane.left, pane.top, pane.width, pane.height)
  ctx.clip()
  paintConnections(ctx, points, pane, dark)
  let lastX = Infinity
  let latest = null
  // Sample in CSS pixels backward to retain the newest visible snapshot at every zoom level.
  for (let i = points.length - 1; i >= 0; i--) {
    const point = points[i]
    if (!point || point.x < pane.left || point.x > pane.right || lastX - point.x < pitch) continue
    const nodes = [...point.nodes.values()].filter((node) => node.y >= pane.top && node.y <= pane.bottom)
    if (!nodes.length) continue
    if (!latest) latest = nodes
    lastX = point.x
    for (const node of nodes) paintNode(ctx, node, radius, dark)
  }
  if (latest) paintLabels(ctx, latest, pane, radius, dark)
  ctx.restore()
}
