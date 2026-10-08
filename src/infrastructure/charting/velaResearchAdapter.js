/** Vela's time boundary is epoch milliseconds; saved Lab drawings use dates/seconds. */
export function toVelaTime(time) {
  if (typeof time === 'number') return time * 1000
  if (time && typeof time === 'object') {
    return Date.UTC(time.year, time.month - 1, time.day)
  }
  return Date.parse(`${time}T00:00:00Z`)
}

export function toVelaBars(rows) {
  return rows.map(({ date, open, high, low, close, volume }) => ({
    time: toVelaTime(date),
    open,
    high,
    low,
    close,
    volume,
  }))
}

/** Preserve sparse dates as explicit gaps, including isolated latest-only points. */
export function toVelaSeries(series, dates, prefix) {
  const byTime = new Map((series.points ?? []).map((point) => [point.time, point.value]))
  return {
    id: `${prefix}:${series.id}`,
    title: velaSeriesTitle(series),
    paneId: '',
    kind: series.render === 'point' ? 'circles' : 'line',
    points: dates.map((date, index) => ({
      time: toVelaTime(date),
      value: finiteOrNull(series.values ? series.values[index] : byTime.get(date)),
    })),
    style: { color: series.color, width: series.lineWidth ?? 1, lineStyle: series.lineStyle ?? 'solid' },
  }
}

export function buildVelaResearchGroups(model, prefix) {
  return (model?.groups ?? [])
    .filter((group) => group.active)
    .flatMap((group) => {
      const buckets = new Map()
      for (const series of [...group.series, ...(group.guides ?? [])]) {
        // The renderer's current-price line already owns the latest close and its axis label.
        if (group.id === 'price' && series.id === 'mark') continue
        if (series.active === false || !series.points?.some((point) => Number.isFinite(point.value))) continue
        // Each price legend owns its actual host command, not the unrelated master band switch.
        const scale = group.id === 'price' ? (series.controls?.at(-1) ?? 'price') : seriesScale(group.id, series)
        if (!buckets.has(scale)) buckets.set(scale, [])
        buckets.get(scale).push(toVelaSeries(series, model.dates, prefix))
      }
      return [...buckets].map(([scale, series]) => ({
        id: `${group.id}.${scale}`,
        groupId: group.id,
        overlayKey: group.id === 'price' ? (scale === 'price' ? null : scale) : group.overlayKey,
        title:
          group.id === 'price'
            ? priceLabel(scale, group.label)
            : buckets.size === 1
              ? group.label
              : `${group.label} · ${scaleLabel(scale)}`,
        overlay: group.id === 'price',
        output: { series },
      }))
    })
}

export function buildVelaHostOutput({ rows, markers, costPath, overlays }, prefix) {
  const costByDate = new Map(costPath.map((point) => [point.date, point]))
  const backgrounds = overlays.regime
    ? rows.flatMap((row, index) => {
        const cost = costByDate.get(row.date)
        if (!Number.isFinite(cost?.upper) || !Number.isFinite(cost?.lower)) return []
        const color =
          row.close > cost.upper
            ? 'rgba(169,50,38,0.45)'
            : row.close < cost.lower
              ? 'rgba(39,79,159,0.45)'
              : 'rgba(14,117,88,0.35)'
        return [
          {
            id: `${prefix}:regime:${index}`,
            paneId: '',
            from: toVelaTime(row.date),
            to: rows[index + 1] ? toVelaTime(rows[index + 1].date) : toVelaTime(row.date) + 86400000,
            color,
          },
        ]
      })
    : []
  return {
    backgrounds,
    series: [
      {
        id: `${prefix}:markers`,
        title: 'Lab 回放 / 研究标记',
        paneId: '',
        kind: 'markers',
        markers: markers.map((marker) => ({ ...marker, time: toVelaTime(marker.time), size: 'small' })),
      },
    ],
  }
}

function seriesScale(group, series) {
  if (series.scale) return series.scale
  if (group === 'greeks') return series.id.replace(/^bs/, '').toLowerCase()
  if (group === 'lp') return series.id === 'lpValue' ? 'value' : series.id === 'lpCe' ? 'efficiency' : 'ratio'
  return 'shared'
}

function scaleLabel(scale) {
  return (
    { delta: 'Delta', gamma: 'Gamma', theta: 'Theta', value: '价值', efficiency: '效率', ratio: '比例' }[scale] ?? scale
  )
}

function priceLabel(control, fallback) {
  return (
    {
      costBand: '成本带',
      volBand: 'GetDelta 价格带',
      lpBand: 'LP 价格带',
      causalEquilibrium: '动态均衡 · 因果模型',
      entryLine: '入场价',
      executionMarkers: '目标 / 失效',
    }[control] ?? fallback
  )
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

export function velaSeriesTitle(series) {
  return ['pct', 'ratio'].includes(series.unit) ? `${series.label}（比例，1=100%）` : series.label
}
