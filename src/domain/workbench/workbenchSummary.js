export function buildWorkbenchSummary({ source, rows = [], graph }) {
  const decision = graph?.decision
  const dataThrough = rows.at(-1)?.date ?? source?.dataThrough ?? ''
  const dataState = resolveDataState(source, rows)
  const missingInput = decision?.missingInputs?.[0] ?? null
  const blockedReason = decision?.blockedReasons?.[0] ?? null
  const reason = blockedReason ?? decision?.timing?.reason ?? '等待市场样本形成明确条件。'
  const invalidation = decision?.invalidations?.[0] ?? '缺失输入：尚未形成可复核的失效条件。'
  const nextCheck = missingInput
    ? `如需运行模拟，先补充${humanizeMissingInput(missingInput)}。`
    : blockedReason
      ? `下一根 K 线后复核：${blockedReason}。`
      : '下一根 K 线后复核成本锚、阶段和失效条件。'

  return {
    data: {
      state: dataState,
      label: dataStateLabel(dataState),
      detail: buildDataDetail(source, rows, dataThrough),
      dataThrough,
      rows: rows.length,
      source: source?.source ?? '本地数据源未标注',
      claimClass: rows.length ? 'sample-estimate' : 'missing-input',
    },
    gate: {
      state: decision?.state ?? '等待载入',
      executionStatus: decision?.executionStatus ?? 'blocked',
      label: decision?.executionStatus === 'simulation-only' ? '仅模拟' : '不可执行',
    },
    reason,
    invalidation,
    nextCheck,
    disclosure: '本地日线样本只用于研究；偏离度不是胜率，手绘标注不进入公式或模拟挂单。',
  }
}

function resolveDataState(source, rows) {
  if (!rows.length) return 'invalid'
  if (source?.isStale) return 'stale'
  return 'provisional'
}

function dataStateLabel(state) {
  if (state === 'invalid') return '不可用'
  if (state === 'stale') return '需刷新'
  return '可研究'
}

function buildDataDetail(source, rows, dataThrough) {
  if (!rows.length) return '尚未载入 K 线。'
  const interval = source?.interval ?? '周期未标注'
  const date = dataThrough || '截止日未知'
  return `${rows.length} 根 ${interval} K 线 · 截至 ${date}`
}

function humanizeMissingInput(value) {
  const labels = {
    'account.capital': '账户资金',
    'account.basePosition': '底仓名义',
    'verified-market-iv-source': '可验证的市场波动率来源',
    'option-leg-premium': '期权腿报价',
  }
  return labels[value] ?? String(value).replaceAll('.', ' / ')
}
