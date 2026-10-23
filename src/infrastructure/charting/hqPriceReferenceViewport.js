import { dateNumber } from './hqChartDataAdapter.js'
import { readHqStockChipViewport } from './hqChartViewport.js'

/** Native HQ coordinates, including its log scale and aggregated bar dates. */
export function readHqPriceReferenceViewport(chart) {
  const vertical = readHqStockChipViewport(chart)
  const container = chart?.JSChartContainer
  const frame = container?.Frame?.SubFrame?.[0]?.Frame
  const data = container?.ChartPaint?.[0]?.Data
  if (!vertical || typeof frame?.GetXFromIndex !== 'function') return null
  const border = frame.GetBorder?.() ?? frame.ChartBorder?.GetBorder?.()
  const ratio = Number(globalThis.window?.devicePixelRatio) || 1
  const left = Number(border?.LeftEx ?? border?.Left) / ratio
  const right = Number(border?.RightEx ?? border?.Right) / ratio
  const width = Number(border?.ChartWidth) / ratio
  const height = Number(border?.ChartHeight) / ratio
  const origin = Number(frame.GetXFromIndex(0, false)) / ratio
  const barSpacing = Number(frame.GetXFromIndex(1, false)) / ratio - origin
  if (![left, right, width, height, origin, barSpacing].every(Number.isFinite)) return null
  if (right <= left || width <= 0 || height <= 0 || barSpacing <= 0) return null

  const rows = data.Data
  const offset = data.DataOffset
  // The monitor reads every frame; allocate the lookup only when a repaint
  // actually asks for coordinates. Never map an earlier day to a later bar.
  let dates = null
  const dateIndex = () => {
    if (!dates) {
      dates = new Map()
      rows.forEach((row, index) => {
        const date = Number(row?.Date)
        if (Number.isInteger(date) && date > 0 && !dates.has(date)) dates.set(date, index)
      })
    }
    return dates
  }
  const projectX = (date) => {
    const index = dateIndex().get(dateNumber(date))
    if (index === undefined || index < offset - 1 || index > vertical.activeIndex + 1) return null
    return frame.GetXFromIndex(index - offset, false) / ratio
  }
  return {
    width,
    height,
    pixelRatio: ratio,
    bounds: { left, top: vertical.top, width: right - left, height: vertical.height },
    barSpacing,
    hasDate: (date) => dateIndex().has(dateNumber(date)),
    projectX,
    // Do not clamp off-screen nodes onto a visible price boundary.
    projectY: (price) => frame.GetYFromData(price, false) / ratio,
    signature: [
      vertical.signature,
      left,
      right,
      width,
      height,
      origin,
      barSpacing,
      ratio,
      rows.length,
      rows[0]?.Date,
      rows.at(-1)?.Date,
      container.Period,
    ].join('|'),
  }
}
