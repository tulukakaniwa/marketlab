import { dateNumber, toHqSymbol } from './hqChartDataAdapter.js'

export const HQ_RESEARCH_API_PREFIX = 'market-lab:'

export function hqResearchApiId(groupId) {
  return `${HQ_RESEARCH_API_PREFIX}${String(groupId || 'unknown')}`
}

export function buildHqResearchChartConfig(model, { windowOffset = 4 } = {}) {
  const groups = drawableGroups(model)
  const price = groups.find((group) => group.id === 'price')
  const panes = groups.filter((group) => group.id !== 'price' && group.id !== 'volume')
  const paneGroups = panes.map((group) => splitScaleGroups(group))
  const paneWindows = paneGroups.map((groups) => groups[0])
  const paneOverlays = paneGroups.flatMap((groups, paneIndex) =>
    groups.slice(1).map((group) => ({
      Windows: windowOffset + paneIndex,
      Identify: hqResearchApiId(group.id),
      API: apiDescriptor(group),
      IsShareY: false,
      IsCalculateYMaxMin: true,
      // 数值和单位由共享 Light 图例给出。多重右轴会在窄屏吞掉一半
      // 绘图区，且 Light 本身也不显示这些额外轴标签。
      ShowRightText: false,
    })),
  )
  return {
    overlayIndex: price
      ? [
          {
            Windows: 0,
            Identify: hqResearchApiId(price.id),
            API: apiDescriptor(price),
            IsShareY: true,
            IsCalculateYMaxMin: true,
            ShowRightText: false,
          },
          ...paneOverlays,
        ]
      : paneOverlays,
    windows: paneWindows.map((group) => ({
      API: apiDescriptor(group),
      Modify: false,
      Change: false,
      Close: false,
      Overlay: false,
      // 只恢复 HQ 用户熟悉的副图放大/还原与折叠/展开；指标切换、
      // 参数、关闭窗口等仍禁用，避免绕过 Lab 的受控分组。
      MaxMin: true,
      TitleWindow: true,
      AddIndexWindow: false,
      IndexHelp: false,
      IndexAIAnalyze: false,
      // 折叠成标题条后保留受控 Lab 分组名，避免出现看不懂的空白条。
      IsShowIndexName: true,
      IsShowOverlayIndexName: false,
      TitleHeight: 22,
    })),
    frames: panes.map((group) => ({
      Height: group.height ?? paneHeight(group.id),
      SplitCount: group.id === 'equity' ? 2 : 3,
      StringFormat: group.unit === 'pct' || group.unit === 'ratio' ? 2 : 0,
    })),
    paneGroups,
  }
}

export function toHqResearchIndexResponse(model, apiId, source = {}) {
  const groupId = String(apiId || '').startsWith(HQ_RESEARCH_API_PREFIX)
    ? String(apiId).slice(HQ_RESEARCH_API_PREFIX.length)
    : ''
  const group = apiGroups(model).find((item) => item.id === groupId)
  const symbol = toHqSymbol(source)
  if (!group) {
    return {
      // HQChart 在 code !== 0 时会先静默 return，根本不读取 error。
      code: 0,
      stock: { symbol, name: String(source.label ?? source.symbol ?? symbol) },
      error: { message: `Market Lab 指标组不可用: ${groupId || 'unknown'}` },
      outdata: { name: 'Market Lab', date: [], outvar: [] },
    }
  }

  const dates = normalizedDates(model, group)
  return {
    code: 0,
    stock: { symbol, name: String(source.label ?? source.symbol ?? symbol) },
    outdata: {
      name: `Lab · ${group.label}`,
      date: dates,
      outvar: group.series.filter(seriesDrawable).map((series) => toHqOutVar(series, dates, model?.dates)),
    },
  }
}

export function isHqResearchApiRequest(request) {
  const id = request?.Request?.Data?.indexname
  return typeof id === 'string' && id.startsWith(HQ_RESEARCH_API_PREFIX)
}

function apiDescriptor(group) {
  return {
    Name: `Lab · ${group.label}`,
    ID: hqResearchApiId(group.id),
    Url: 'local://market-lab/research-index',
  }
}

function drawableGroups(model) {
  if (!Array.isArray(model?.groups)) return []
  return model.groups
    .map((group) => ({ ...group, series: [...(group?.series ?? []), ...(group?.guides ?? [])] }))
    .filter(
      (group) =>
        group?.active === true &&
        (group.state === 'ready' || group.state === 'estimated') &&
        Array.isArray(group.series) &&
        group.series.some(seriesDrawable),
    )
}

function seriesDrawable(series) {
  if (!series || series.active === false) return false
  if (Array.isArray(series.values)) return series.values.some(Number.isFinite)
  const points = series.points ?? series.data
  return Array.isArray(points) && points.some((point) => Number.isFinite(point?.value))
}

function normalizedDates(model, group) {
  const sourceDates = Array.isArray(model?.dates) ? model.dates : collectDates(group.series)
  return [...new Set(sourceDates.map(dateNumber).filter((date) => date > 0))].sort((left, right) => left - right)
}

function collectDates(series) {
  const dates = new Set()
  for (const item of series ?? []) {
    for (const point of item.points ?? item.data ?? []) {
      const time = point?.date ?? point?.time
      if (dateNumber(time) > 0) dates.add(time)
    }
  }
  return [...dates].sort((left, right) => dateNumber(left) - dateNumber(right))
}

function toHqOutVar(series, dates, sourceDates) {
  const values = alignedValues(series, dates, sourceDates)
  const lineDash = series.lineStyle === 'dashed' ? [5, 4] : undefined
  return {
    name: series.label,
    type: series.render === 'point' ? 3 : 0,
    data: values,
    color: toHqColor(series.color),
    linewidth: `LINETHICK${series.lineWidth ?? (series.render === 'point' ? 2 : 1)}`,
    isDotLine: series.lineStyle === 'dotted',
    // HQ 原始标题只支持原始数值格式，百分比等会和 Light 口径不同。
    // 所有指标值统一交给共享 legend；窗口仍保留简短的分组名称。
    IsShowTitle: false,
    ...(lineDash ? { lineDash } : {}),
  }
}

function alignedValues(series, dates, sourceDates) {
  if (Array.isArray(series.values)) {
    const byDate = new Map(
      (Array.isArray(sourceDates) ? sourceDates : dates).map((date, index) => [
        dateNumber(date),
        finiteOrNull(series.values[index]),
      ]),
    )
    return dates.map((date) => byDate.get(date) ?? null)
  }
  const points = series.points ?? series.data ?? []
  const byDate = new Map(points.map((point) => [dateNumber(point?.date ?? point?.time), finiteOrNull(point?.value)]))
  return dates.map((date) => byDate.get(date) ?? null)
}

export function toHqColor(value) {
  const color = String(value ?? '').trim()
  if (/^rgba?\(/i.test(color)) return color
  const short = color.match(/^#([\da-f])([\da-f])([\da-f])$/i)
  if (short) {
    const [, red, green, blue] = short
    return `rgb(${parseInt(red + red, 16)},${parseInt(green + green, 16)},${parseInt(blue + blue, 16)})`
  }
  const full = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i)
  if (!full) return color
  const [, red, green, blue, alpha] = full
  const channels = [red, green, blue].map((channel) => parseInt(channel, 16))
  if (!alpha) return `rgb(${channels.join(',')})`
  return `rgba(${channels.join(',')},${Number((parseInt(alpha, 16) / 255).toFixed(3))})`
}

export function applyHqResearchSeriesStyle(data, model) {
  const chart = data?.Chart
  const series = findSeriesByLabel(model, chart?.Name)
  if (!chart || !series) return false
  chart.Color = toHqColor(series.color)
  chart.LineWidth = series.lineWidth ?? 1
  chart.IsDotLine = series.lineStyle === 'dotted'
  chart.LineDash = series.lineStyle === 'dashed' ? [5, 4] : series.lineStyle === 'dotted' ? [2, 2] : []
  // HQChart 为 API 指标线默认使用 DrawType=1，遇到 null 会断开；
  // Lightweight Charts 则只接收有限点并跨过缺失日期连线。这里只调整
  // 多点线的绘制方式，不改原始 null、不插值，也不影响单点/点图指标。
  if (series.render !== 'point' && finiteSeriesPointCount(series) >= 2) chart.DrawType = 0
  return true
}

// 保留旧导出，避免已存在的调用方失效。
export const applyHqOverlaySeriesStyle = applyHqResearchSeriesStyle

function findSeriesByLabel(model, label) {
  for (const group of model?.groups ?? []) {
    const series = [...(group?.series ?? []), ...(group?.guides ?? [])].find((item) => item?.label === label)
    if (series) return series
  }
  return null
}

function finiteSeriesPointCount(series) {
  if (Array.isArray(series?.values)) return series.values.filter(Number.isFinite).length
  const points = series?.points ?? series?.data
  return Array.isArray(points) ? points.filter((point) => Number.isFinite(point?.value)).length : 0
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function paneHeight(groupId) {
  if (groupId === 'equity') return 1.1
  if (groupId === 'kdj' || groupId === 'rsi') return 1.3
  return 1.45
}

function apiGroups(model) {
  return drawableGroups(model).flatMap((group) => (group.id === 'price' ? [group] : splitScaleGroups(group)))
}

function splitScaleGroups(group) {
  const buckets = new Map()
  for (const series of group.series.filter(seriesDrawable)) {
    const scale = seriesScale(group.id, series)
    if (!buckets.has(scale)) buckets.set(scale, [])
    buckets.get(scale).push(series)
  }
  return [...buckets.entries()].map(([scale, series], index) => ({
    ...group,
    id: buckets.size === 1 ? group.id : `${group.id}.${scale}`,
    label: buckets.size === 1 || index === 0 ? group.label : `${group.label} · ${scaleLabel(scale)}`,
    series,
  }))
}

function seriesScale(groupId, series) {
  if (series.scale) return series.scale
  if (groupId === 'greeks') return series.id.replace(/^bs/, '').toLowerCase()
  if (groupId === 'lp') {
    if (series.id === 'lpValue') return 'value'
    if (series.id === 'lpCe') return 'efficiency'
    return 'ratio'
  }
  return 'shared'
}

function scaleLabel(scale) {
  const labels = { delta: 'Delta', gamma: 'Gamma', theta: 'Theta', value: '价值', efficiency: '效率', ratio: '比例' }
  return labels[scale] ?? scale
}
