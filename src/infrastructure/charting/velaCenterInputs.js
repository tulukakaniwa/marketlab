import { ECONOMIC_CENTER_DEFAULTS } from '../../domain/market-model/economicCenters.js'
import { STATISTICAL_CENTER_DEFAULTS, STATISTICAL_CENTER_LIMITS } from '../../domain/market-model/statisticalCenter.js'

const optionalNumber = (key, title, tooltip) => ({ key, title, type: 'string', defval: '', tooltip })
const scenarioEnabled = () => ({
  key: 'enabled',
  title: '启用显式情景',
  type: 'bool',
  defval: false,
  tooltip: '参数只应用于设置时的观察日；切换日期后需重新应用。',
})
const CONFIG = Object.freeze({
  statisticalCenter: [
    {
      key: 'lookback',
      title: '统计窗口（已收盘柱）',
      type: 'int',
      step: 1,
      defval: STATISTICAL_CENTER_DEFAULTS.lookback,
      min: STATISTICAL_CENTER_LIMITS.minimumObservations,
      max: STATISTICAL_CENTER_LIMITS.maximumLookback,
    },
    {
      key: 'minObservations',
      title: '最少观察数',
      type: 'int',
      step: 1,
      defval: STATISTICAL_CENTER_DEFAULTS.minObservations,
      min: STATISTICAL_CENTER_LIMITS.minimumObservations,
      max: STATISTICAL_CENTER_LIMITS.maximumLookback,
    },
  ],
  vwapCost: [
    {
      key: 'lookback',
      title: '成交重心窗口（已收盘柱）',
      type: 'int',
      step: 1,
      defval: ECONOMIC_CENTER_DEFAULTS.lookback,
      min: 1,
      max: ECONOMIC_CENTER_DEFAULTS.maximumLookback,
    },
    optionalNumber(
      'amountPerVolumeToPrice',
      '成交额 / 量单位换算（可留空）',
      '数值；成交额除以成交量后的单位换算。缺省不推断单位。',
    ),
  ],
  supplyDemand: [
    scenarioEnabled(),
    optionalNumber('a', '需求截距 a（可留空）', '数值，数量 / 会话。'),
    optionalNumber('b', '需求斜率 b（可留空）', '数值，数量 / 价格 / 会话。'),
    optionalNumber('c', '供给截距 c（可留空）', '数值，数量 / 会话。'),
    optionalNumber('d', '供给斜率 d（可留空）', '数值，数量 / 价格 / 会话。'),
  ],
  fundamental: [
    scenarioEnabled(),
    optionalNumber(
      'nextDividend',
      '预期下期每单位股息 D₁（可留空）',
      '数值，预期下一年每单位分红，与标的价格单位一致。',
    ),
    optionalNumber('requiredReturn', '年要求收益 r（可留空）', '数值，比例；1 = 100%。'),
    optionalNumber('growthRate', '年增长 g（可留空）', '数值，比例；1 = 100%。'),
  ],
})

/** Optional numbers use the native text control: Vela float controls coerce blank to 0. */
export function velaCenterInputsSchema(formula) {
  return (CONFIG[formula] ?? []).map((input) => ({ ...input }))
}
export function velaCenterDefaultInputs(formula) {
  return Object.fromEntries((CONFIG[formula] ?? []).map(({ key, defval }) => [key, defval]))
}
export function velaCenterInputValues(formula, config) {
  return Object.fromEntries(
    (CONFIG[formula] ?? []).map(({ key, defval }) => {
      const value = config?.[formula]?.[key]
      return [key, value === undefined ? defval : value === null ? '' : value]
    }),
  )
}
export function velaCenterInputChanges(formula, current, previous) {
  return (CONFIG[formula] ?? []).flatMap((input) => {
    const value = commandValue(input, current?.[input.key])
    return value !== undefined && value !== commandValue(input, previous?.[input.key])
      ? [{ formula, key: input.key, value }]
      : []
  })
}
export function velaCenterRejectedInputKeys(formula, current) {
  return (CONFIG[formula] ?? [])
    .filter((input) => commandValue(input, current?.[input.key]) === undefined)
    .map(({ key }) => key)
}
function commandValue(input, value) {
  if (input.type === 'bool') return typeof value === 'boolean' ? value : undefined
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null
  const parsed = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(parsed) ? parsed : undefined
}
