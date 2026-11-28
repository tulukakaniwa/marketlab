import { blackScholes } from '../formulas/core.js'

const OPTION_FORMULA_IDS = new Set(['option-greeks', 'portfolio', 'risk-surface', 'asian-option', 'gamma-pnl'])

const MAX_SERIES_WINDOW = 160

export function isOptionResearchFormula(formulaId) {
  return OPTION_FORMULA_IDS.has(formulaId)
}

/**
 * 期权研究专用时间序列查询（纯领域计算，零 UI 依赖）。
 * 优先消费已计算的 formulaPath 期权序列；若主图未开启场景投影但研究输入齐全，
 * 则按用户显式期权参数在最近有界窗口上生成研究级 Greeks 序列（明确标注 research-only）。
 */
export function buildOptionGreeksChartModel({ rows = [], formulaPath = [], graph = null, market = null } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return unavailableModel(['market-rows'])
  }

  const windowRows = rows.slice(-MAX_SERIES_WINDOW)
  const windowDates = windowRows.map((row) => row.date)
  const pathByDate = new Map((formulaPath ?? []).map((point) => [point.date, point]))
  const hasPathGreeks = windowDates.some((date) => Number.isFinite(pathByDate.get(date)?.optionDelta))

  if (hasPathGreeks) {
    return assembleModel(
      windowDates,
      (date) => {
        const point = pathByDate.get(date)
        return {
          delta: finiteOrNull(point?.optionDelta),
          gamma: finiteOrNull(point?.optionGamma),
          theta: finiteOrNull(point?.optionThetaPerSession),
        }
      },
      'formula-path',
    )
  }

  const inputs = graph?.researchInputs ?? graph?.inputs ?? {}
  const strikePrice = positive(inputs.strikePrice)
  const tenorSessions = positive(inputs.optionTenorSessions)
  const iv = positive(inputs.iv ?? market?.annualVol)
  const tdpy = positive(inputs.tradingDaysPerYear ?? market?.tradingDaysPerYear)
  const missing = [
    strikePrice ? null : 'strikePrice',
    tenorSessions ? null : 'optionTenorSessions',
    iv ? null : 'iv',
    tdpy ? null : 'tradingDaysPerYear',
  ].filter(Boolean)

  if (missing.length) {
    return unavailableModel(missing)
  }

  const riskFreeRate = Number.isFinite(Number(inputs.riskFreeRate)) ? Number(inputs.riskFreeRate) : 0.04
  const optionType = inputs.optionType === 'call' ? 'call' : 'put'
  const sign = inputs.optionSide === 'short' ? -1 : 1
  const scale = (positive(inputs.optionQuantity) ?? 1) * (positive(inputs.optionMultiplier) ?? 1) * sign

  return assembleModel(
    windowDates,
    (_date, index) => {
      const close = positive(windowRows[index]?.close)
      if (!close) return { delta: null, gamma: null, theta: null }
      const bs = blackScholes({
        entryPrice: close,
        strikePrice,
        timeToExpirySessions: tenorSessions,
        iv,
        riskFreeRate,
        type: optionType,
        tradingDaysPerYear: tdpy,
      })
      return {
        delta: finiteOrNull(bs ? bs.optionDelta * scale : null),
        gamma: finiteOrNull(bs ? bs.optionGamma * scale : null),
        theta: finiteOrNull(bs ? bs.optionThetaPerSession * scale : null),
      }
    },
    'explicit-option-scenario',
  )
}

function assembleModel(dates, evalAt, basis) {
  const deltaPoints = []
  const gammaPoints = []
  const thetaPoints = []
  dates.forEach((date, index) => {
    const sample = evalAt(date, index)
    if (sample.delta !== null) deltaPoints.push({ time: date, value: sample.delta })
    if (sample.gamma !== null) gammaPoints.push({ time: date, value: sample.gamma })
    if (sample.theta !== null) thetaPoints.push({ time: date, value: sample.theta })
  })

  if (!deltaPoints.length && !gammaPoints.length && !thetaPoints.length) {
    return unavailableModel(['finite-option-greeks'])
  }

  return {
    status: 'research-only',
    basis,
    missingInputs: [],
    dates,
    groups: [
      {
        id: 'greeks',
        label: '期权 Greeks',
        active: true,
        state: 'ready',
        unit: 'ratio',
        height: 1.5,
        series: [
          {
            id: 'bsDelta',
            label: '期权 Delta',
            scale: 'delta',
            color: '#0e7558',
            lineWidth: 2,
            lineStyle: 'solid',
            render: 'line',
            active: true,
            points: deltaPoints,
          },
          {
            id: 'bsGamma',
            label: '期权 Gamma',
            scale: 'gamma',
            color: '#274f9f',
            lineWidth: 1,
            lineStyle: 'dashed',
            render: 'line',
            active: true,
            points: gammaPoints,
          },
          {
            id: 'bsTheta',
            label: '期权 Theta/会话',
            scale: 'theta',
            color: '#a93226',
            lineWidth: 1,
            lineStyle: 'dotted',
            render: 'line',
            active: true,
            points: thetaPoints,
          },
        ],
      },
    ],
  }
}

function unavailableModel(missingInputs) {
  return {
    status: 'missing-input',
    basis: 'unavailable',
    missingInputs,
    dates: [],
    groups: [],
  }
}

function positive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null
}
