const DEFINITIONS = [
  ['statisticalCenter', '统计回归中枢', 'P* = exp[c / (1 − φ)] · AR(1)'],
  ['vwapCost', '成交量重心', '成交额 VWAP / HLC3 代理'],
  ['cohortCost', '流通筹码成本代理', 'α = 1 − exp(−成交股数 / 流通股数)'],
  ['supplyDemand', '供需清算价', 'P* = (a − c) / (b + d) · 线性供需'],
  ['fundamental', '股息估值', 'P = D₁ / (r − g)'],
]
const STATUS = {
  ready: '可计算',
  estimated: '代理估计',
  proxy: '代理估计',
  'warming-up': '样本不足',
  unidentified: '未识别稳定中枢',
  'missing-input': '缺少输入',
  'invalid-data': '数据无效',
  'invalid-input': '输入无效',
  'invalid-parameters': '参数无效',
  'numerical-failure': '数值不可用',
  unavailable: '不可计算',
}
const MODEL_HINTS = {
  'residual-autocorrelation-rejected': '残差相关性拒绝该 AR(1) 设定',
  'unit-root-not-rejected': '单位根假设未被拒绝',
  'nonstationary-ar-coefficient': 'AR 系数不在稳定范围内',
  'degenerate-innovations': '创新退化，无法使用统计检验',
}

/** Query-to-view mapping, not a price/plan calculation. Missing values remain missing. */
export function presentMarketCenters(snapshot, queryState, config = {}) {
  return DEFINITIONS.map(([id, label, relation]) => {
    const formula = snapshot?.formulas?.[id]
    const hasValue = Number.isFinite(formula?.value)
    const mismatch =
      ['supplyDemand', 'fundamental'].includes(id) &&
      config[id]?.enabled &&
      config[id]?.provenance?.asOfDate !== (snapshot?.asOfDate ?? queryState?.asOfDate)
    const status = formula?.status ?? formula?.state
    return {
      id,
      label,
      relation,
      hasValue,
      value: hasValue ? formula.value : null,
      stateLabel: mismatch
        ? '情景属于其他观察日'
        : queryState?.status === 'computing'
          ? '计算中'
          : (STATUS[status] ?? '待输入'),
      claimLabel: ['supplyDemand', 'fundamental'].includes(id)
        ? '显式情景'
        : id === 'statisticalCenter'
          ? '统计模型'
          : id === 'vwapCost'
            ? '成交重心'
            : '成本代理',
      missingInputs: formula?.missingInputs ?? [],
      inputHint: missingHint(formula?.missingInputs?.[0]),
      modelHint: id === 'statisticalCenter' ? MODEL_HINTS[formula?.reason] : null,
      formula,
    }
  })
}

function missingHint(key) {
  if (!key) return null
  if (key === 'freeFloat') return '需导入逐日流通股本'
  if (key.includes('volumeUnit')) return '流通股本单位须为 shares，成交量单位须为 reported-volume'
  if (key.includes('volumeToShares')) return '需声明成交量到股数的换算'
  if (key.startsWith('freeFloat.observations.')) return `逐日股本或来源时点缺失/无效：${key.split('.')[2]}`
  if (key.startsWith('freeFloat.provenance')) return '需真实来源及窗口起点以前的可知时点'
  if (key === 'freeFloat.observations-array') return 'observations 须为逐日记录数组'
  if (key === 'units.amountPerVolumeToPrice') return '需声明成交额/成交量到价格的换算'
  if (key === 'amount-for-each-traded-bar') return '窗口内每个有成交日均需有效成交额'
  if (key === 'amount-price-basis-mismatch') return '成交额均价超出当日区间，请核对单位、币种和复权口径'
  return null
}
