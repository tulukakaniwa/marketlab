const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

/** Paint an existing domain query only. Pixel sampling never changes its price levels or strengths. */
export function paintPriceReferenceMap(
  ctx,
  { path = [], costPath = [], projectX, projectY, bounds, dark = false, enabled = true, barSpacing = 8 } = {},
) {
  if (!enabled || !ctx || !bounds || !path.length || bounds.width <= 0 || bounds.height <= 0) return
  const { left, top, width, height } = bounds
  const right = left + width,
    bottom = top + height
  const costByDate = new Map()
  // Later duplicate/corrupt records cannot replace a previously observed cost snapshot.
  for (const point of costPath) if (point && !costByDate.has(point.date)) costByDate.set(point.date, point)
  const projected = path.map((point) => ({ point, x: projectX(point.date) }))
  const spacing = finite(barSpacing) && barSpacing > 0 ? barSpacing : 8
  const radius = clamp(spacing * 0.36, 2.6, 5.5)
  const minPitch = Math.max(7, radius * 2 + 2)
  ctx.save()
  ctx.beginPath()
  ctx.rect(left, top, width, height)
  ctx.clip()

  // Only adjacent, valid historical snapshots form a band; no extrapolation past the last date.
  ctx.fillStyle = dark ? '#d9ac45' : '#ad7b1c'
  ctx.globalAlpha = dark ? 0.085 : 0.06
  let previous = null
  for (const { point, x } of projected) {
    const cost = costByDate.get(point.date)
    const valid =
      point.status === 'ready' &&
      finite(x) &&
      finite(cost?.lower) &&
      finite(cost?.upper) &&
      cost.lower > 0 &&
      cost.upper >= cost.lower
    const upper = valid ? projectY(cost.upper) : null,
      lower = valid ? projectY(cost.lower) : null
    const current = valid && finite(upper) && finite(lower) ? { x, upper, lower } : null
    if (current && previous && x > previous.x && x >= left && previous.x <= right) {
      ctx.beginPath()
      ctx.moveTo(previous.x, previous.upper)
      ctx.lineTo(x, upper)
      ctx.lineTo(x, lower)
      ctx.lineTo(previous.x, previous.lower)
      ctx.closePath()
      ctx.fill()
    }
    previous = current
  }

  // Sample backward in screen space so the newest visible observation always survives zoom-out.
  let lastX = Infinity
  for (let i = projected.length - 1; i >= 0; i--) {
    const { point, x } = projected[i]
    if (point.status !== 'ready' || !finite(x) || x < left || x > right || lastX - x < minPitch) continue
    const dots = (point.nodes ?? []).flatMap((node) => {
      if (!finite(node.price) || node.price <= 0 || !finite(node.intensity) || node.intensity <= 0) return []
      const y = projectY(node.price)
      return finite(y) && y >= top && y <= bottom ? [{ node, y }] : []
    })
    if (!dots.length) continue
    lastX = x
    for (const { node, y } of dots) {
      const intensity = clamp(node.intensity, 0, 1)
      // Radius uses sqrt(strength), making disk area proportional to the supplied intensity.
      const size = radius * Math.sqrt(intensity)
      ctx.fillStyle = node.side === 'below' ? (dark ? '#64bdc8' : '#24899c') : dark ? '#e4bb53' : '#b47e17'
      ctx.globalAlpha = 0.22 + intensity * 0.5
      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fill()
      if (node.isPoc) {
        ctx.globalAlpha = dark ? 0.88 : 0.75
        ctx.strokeStyle = dark ? '#f8e8b4' : '#73501c'
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}
