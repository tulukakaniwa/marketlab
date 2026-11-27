import { computed } from 'vue'
import { deriveStateRecurrence, gammaPnl, meanReversionHalfLife, volConfidence } from '../domain/formulas/core.js'

export function useFormulaSecondOrderModel({ props, activeIndex, activeRows, layout }) {
  const { W = 440, H = 190, PL, PR = 24, sy, pw } = layout

  const mrData = computed(() => {
    const series = (props.costPath || [])
      .slice(0, activeIndex.value + 1)
      .map((c, i) => {
        const row = props.rows?.[i]
        return c?.anchor > 0 && row ? (row.close - c.anchor) / c.anchor : null
      })
      .filter((v) => v !== null)
    if (series.length < 5) return null
    const result = meanReversionHalfLife({
      costDistanceSeries: series,
      tradingDaysPerYear: props.graph.inputs?.tradingDaysPerYear,
    })
    return result ? { ...result, plotHorizonSessions: decayPlotHorizon(result) } : null
  })

  const dynamicHoldingData = computed(() => props.graph?.dynamicHolding ?? null)

  const decayCurve = computed(() => {
    try {
      const d = mrData.value
      if (!d?.halfLifeSessions || !Number.isFinite(d.arDecayRatePerStep)) return ''
      const maxT = d.plotHorizonSessions
      const n = 50
      const pts = []
      for (let i = 0; i <= n; i++) {
        const t = (maxT / n) * i
        const decay = Math.exp(-d.arDecayRatePerStep * t)
        if (Number.isFinite(decay)) pts.push(`${PL + (t / maxT) * pw},${sy(decay)}`)
      }
      return pts.join(' ')
    } catch {
      return ''
    }
  })
  const hlMarker = computed(() => {
    try {
      const d = mrData.value
      if (!d?.halfLifeSessions || !Number.isFinite(d.halfLifeSessions)) return { x: PL, y: sy(0) }
      const maxT = d.plotHorizonSessions
      const x = PL + (d.halfLifeSessions / maxT) * pw
      if (!Number.isFinite(x)) return { x: PL, y: sy(0) }
      return { x, y: sy(0.5) }
    } catch {
      return { x: PL, y: sy(0) }
    }
  })

  const gpData = computed(() =>
    gammaPnl({
      gamma: props.graph.option?.optionGamma,
      priceChange: Math.abs(props.market?.costDistance ?? 0) * (props.market?.markPrice ?? 0),
      positionSize: 1,
      markPrice: props.market?.markPrice,
    }),
  )
  const gammaCurve = computed(() => {
    try {
      const g = gpData.value
      if (!g) return ''
      const maxDP = (props.market?.markPrice || 1) * 0.3
      const n = 50
      const pts = []
      const maxPnl = Math.abs(0.5 * (g.positionGamma || 0.0001) * maxDP * maxDP) || 0.01
      for (let i = 0; i <= n; i++) {
        const dp = -maxDP + ((2 * maxDP) / n) * i
        const pnl = 0.5 * (g.positionGamma || 0) * dp * dp
        const x = PL + ((dp + maxDP) / (2 * maxDP)) * pw
        const y = sy(Math.min(1, Math.abs(pnl) / maxPnl))
        if (Number.isFinite(x) && Number.isFinite(y)) pts.push(`${x},${y}`)
      }
      return pts.join(' ')
    } catch {
      return ''
    }
  })
  const gpMarker = computed(() => {
    try {
      const g = gpData.value
      const maxDP = (props.market?.markPrice || 1) * 0.3
      const dp = g?.priceChange || 0
      const maxPnl = Math.abs(0.5 * (g?.positionGamma || 0.0001) * maxDP * maxDP) || 0.01
      const cx = PL + ((dp + maxDP) / (2 * maxDP)) * pw
      const cy = sy(Math.min(1, Math.abs(g?.gammaPnl || 0) / maxPnl))
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return { cx: PL, cy: sy(0) }
      return { cx, cy }
    } catch {
      return { cx: PL, cy: sy(0) }
    }
  })

  const vcData = computed(() =>
    volConfidence({
      annualVol: props.market?.annualVol || props.graph.inputs?.iv,
      sampleSize: activeRows.value.length,
    }),
  )

  const stateRecurrenceData = computed(() => {
    const precomputed = props.graph?.stateRecurrence
    if (precomputed && activeIndex.value >= (props.rows?.length ?? 0) - 1) return precomputed
    const costDistanceSeries = (props.costPath || []).slice(0, activeIndex.value + 1).map((c, i) => {
      const row = props.rows?.[i]
      return c?.anchor > 0 && row?.close > 0 ? (row.close - c.anchor) / c.anchor : null
    })
    const dates = (props.rows || []).slice(0, activeIndex.value + 1).map((r) => r?.date ?? null)
    return deriveStateRecurrence({ costDistanceSeries, dates })
  })

  const recurrenceChart = computed(() => {
    const rec = stateRecurrenceData.value
    const pts = rec?.kaplanMeier?.points
    if (rec?.status !== 'ok' || !pts?.length) return null
    const maxTime = Math.max(pts.at(-1).timeSessions, 1)
    const xAt = (t) => PL + (Math.min(Math.max(t, 0), maxTime) / maxTime) * pw
    const stepCoords = [`${xAt(0)},${sy(1)}`]
    const upperCoords = [`${xAt(0)},${sy(1)}`]
    const lowerCoords = [`${xAt(0)},${sy(1)}`]
    let prevS = 1
    let prevHi = 1
    let prevLo = 1
    for (const p of pts) {
      const x = xAt(p.timeSessions)
      stepCoords.push(`${x},${sy(prevS)}`, `${x},${sy(p.survivalProbability)}`)
      upperCoords.push(`${x},${sy(prevHi)}`, `${x},${sy(p.confidenceUpper95)}`)
      lowerCoords.push(`${x},${sy(prevLo)}`, `${x},${sy(p.confidenceLower95)}`)
      prevS = p.survivalProbability
      prevHi = p.confidenceUpper95
      prevLo = p.confidenceLower95
    }
    const medianT = rec.recurrencePeriodSessions
    return {
      W,
      H,
      PL,
      PR,
      maxTime,
      zeroY: sy(0),
      halfY: sy(0.5),
      topY: sy(1),
      stepLine: stepCoords.join(' '),
      bandPolygon: [...upperCoords, ...lowerCoords.reverse()].join(' '),
      medianDot: Number.isFinite(medianT) ? { x: xAt(medianT), y: sy(0.5) } : null,
    }
  })

  return {
    mrData,
    dynamicHoldingData,
    decayCurve,
    hlMarker,
    gpData,
    gammaCurve,
    gpMarker,
    vcData,
    stateRecurrenceData,
    recurrenceChart,
  }
}

function decayPlotHorizon(result) {
  if (!Number.isFinite(result?.arDecayRatePerStep) || result.arDecayRatePerStep <= 0) return null
  const sampleSize = Math.max(Number(result.sampleSize) || 1, 2)
  const visibleResidualFloor = 1 / Math.sqrt(sampleSize)
  return Math.max(result.halfLifeSessions, -Math.log(visibleResidualFloor) / result.arDecayRatePerStep)
}
