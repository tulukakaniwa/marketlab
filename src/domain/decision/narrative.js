/**
 * 把决策图字段拼装成中文人话短句
 *
 * 设计原则：
 *   - 纯函数，输入是已经算好的数值，不重算
 *   - 输入异常 / null 给安全兜底字符串
 *   - 文案风格：陈述句，不卖弄术语；保留具体数字（X%）增强可信
 */

function pct(value, digits = 1) {
  if (!Number.isFinite(value)) return ''
  return `${(Math.abs(value) * 100).toFixed(digits)}%`
}

/**
 * 区间摘要：现价相对成本带的位置
 * @returns {string}
 */
export function summarizeRegime(payload) {
  if (!payload || typeof payload !== 'object') return '载入 K 线后判断'
  const { costDistance, costWindow } = payload
  if (!Number.isFinite(costDistance)) return '载入 K 线后判断'
  const window = Number.isFinite(costWindow) && costWindow > 0 ? Math.round(costWindow) : 60
  const baseline = `近 ${window} 日均价`
  const p = pct(costDistance, 1)

  if (costDistance < -0.05) return `深度折价 ${p}，${baseline}下方较远，适合分批吸纳`
  if (costDistance < -0.01) return `小幅折价 ${p}，低于${baseline}，可再等更便宜或开始买`
  if (costDistance > 0.05)  return `溢价 ${p}，高于${baseline}较多，仅做仓位保护`
  if (costDistance > 0.01)  return `回归区上沿 ${p}，略高于${baseline}，观察方向`
  return `贴近均价，等价格给出明确折价`
}

/**
 * 回归概率短句
 * @returns {string|null}
 */
export function summarizeRegression(payload) {
  if (!payload || typeof payload !== 'object') return null
  const { regressionProb } = payload
  if (!Number.isFinite(regressionProb)) return null
  const p = Math.round(regressionProb * 100)
  return `历史上类似偏离，${p}% 概率回归均价`
}

/**
 * 决策原因人话化
 * @returns {string}
 */
export function summarizeReason(payload) {
  if (!payload || typeof payload !== 'object') return '等待 K 线给出明确折价'
  const { costDistance, side } = payload
  if (!Number.isFinite(costDistance)) return '等待 K 线给出明确折价'
  const p = pct(costDistance, 1)

  if (side === 'sell') {
    if (costDistance > 0.05) return `溢价 ${p}，已偏离均价较多，只用底仓减压`
    return `溢价 ${p}，仅做仓位保护，不主动加仓`
  }
  if (side === 'buy') {
    if (costDistance < -0.05) return `折价 ${p}，价格便宜了不少，可分批吸筹`
    if (costDistance < -0.01) return `小幅折价 ${p}，再等更便宜一点或轻仓试探`
    return '回到均价附近，等下一次明确折价'
  }
  if (Math.abs(costDistance) < 0.01) return '价格贴近均价，再等明确方向'
  return costDistance < 0
    ? `折价 ${p}，等动量止跌信号`
    : `溢价 ${p}，仅观察不进场`
}
