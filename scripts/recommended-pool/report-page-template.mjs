const STATUS_META = Object.freeze({
  观察: { id: 'observe', title: '观察', tone: 'observe' },
  等待: { id: 'wait', title: '等待复核', tone: 'wait' },
  剔除: { id: 'excluded', title: '当前剔除', tone: 'excluded' },
  需刷新数据: { id: 'refresh', title: '需刷新数据', tone: 'refresh' },
})

const STATUS_ORDER = Object.freeze(['观察', '等待', '剔除', '需刷新数据'])
const DATA_STATE_LABELS = Object.freeze({
  ready: '数据可用',
  provisional: '暂定数据',
  stale: '数据陈旧',
  invalid: '数据无效',
})
const REASON_LABELS = Object.freeze({
  'phase-falling-expansion-not-observation-gate': '仍处于下跌扩张阶段，尚未通过观察门禁',
  'phase-low-compression-not-observation-gate': '仍处于低位压缩阶段，尚未通过观察门禁',
  'phase-recovery-not-observation-gate': '修复阶段尚未通过观察门禁',
  'drawdown-expanding': '回撤仍在扩大',
  'missing-side-target-horizon-binding': '方向、目标与周期尚未形成完整绑定',
  'local-daily-ohlcv-only': '当前仅有本地日线数据',
  'account-risk-budget-and-live-execution-inputs-unavailable': '缺少账户风险预算与实时执行输入',
})

export function renderRecommendedPoolPage(report) {
  const summary = report.canonicalSummary
  const counts = summary.statusCounts
  const generatedAt = formatTimestamp(report.generatedAt)
  const dataThrough = summary.freshness.newestDataThrough ?? '—'
  const dimensionRows = report.rankingPolicy.dimensions.map(renderDimensionRow).join('')
  const sections = STATUS_ORDER.map((status) => renderStatusSection(report, status)).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>A股研究门禁报告 ${escapeHtml(report.generatedDate)}</title>
  <link rel="stylesheet" href="./report-page.css" />
</head>
<body>
<main>
  <header class="page-head">
    <div>
      <p class="eyebrow">Market Lab · A股 · 日线研究</p>
      <h1>A股研究门禁报告</h1>
      <p class="meta">生成：${escapeHtml(generatedAt)} · 完整日线截止：<strong>${escapeHtml(dataThrough)}</strong></p>
    </div>
    <a class="data-link" href="./data.json">查看证据 JSON</a>
  </header>

  <section class="summary-grid" aria-label="严格门禁摘要">
    ${renderSummaryCard('筛选范围', `${summary.audit.considered} → ${summary.audit.dataReady}`, 'A股全量 → 严格门禁数据集')}
    ${renderSummaryCard('观察', counts.观察, '可进入后续人工复核')}
    ${renderSummaryCard('等待', counts.等待, '门禁尚未解除')}
    ${renderSummaryCard('剔除', counts.剔除, '当前结构不满足')}
    ${renderSummaryCard('短持信号', summary.latestSignalCount, 'combo / latest')}
    ${renderSummaryCard('执行状态', 'blocked', '缺账户与实时执行输入')}
  </section>

  <section class="contract-note">
    <strong>统一口径</strong>
    <span>静态研究白名单开启，并排除酒类、银行、地产与东北样本。白名单只表示当前研究范围命中，不证明机构仍在持仓。</span>
  </section>

  <details class="config" id="config-panel" open>
    <summary>
      <span>动态排序配置</span>
      <small>${escapeHtml(report.rankingPolicy.dimensions.length)} 个诊断维度可调 · 默认展开，可折叠 · 仅同状态组内重排</small>
    </summary>
    <div class="config-body">
      <p>默认沿用严格门禁原始顺序。自定义权重只在同一状态组内重排，不能改变候选状态、执行状态或固定计数。</p>
      <div class="config-toolbar">
        <label>排序模式
          <select id="ranking-mode">
            <option value="canonical">严格门禁原始顺序</option>
            <option value="custom">自定义诊断排序</option>
          </select>
        </label>
        <label>每组展示
          <input id="display-limit" type="number" min="1" max="${escapeHtml(report.totalCandidates)}" value="${escapeHtml(report.topN)}" />
        </label>
        <button id="reset-config" type="button">恢复默认</button>
        <button id="copy-agent-task" type="button">复制 LLM Agent 复核任务</button>
      </div>
      <table class="dimension-table">
        <thead><tr><th>维度</th><th>启用</th><th>权重</th></tr></thead>
        <tbody>${dimensionRows}</tbody>
      </table>
      <p class="config-state" id="config-state" aria-live="polite"></p>
    </div>
  </details>

  ${renderAgentReview(report.agentReview, report.agentReviewRequest)}

  <div class="group-stack">${sections}</div>

  <section class="boundary-note">
    <strong>研究边界</strong>
    <span>诊断分是可配置的复核顺序，不是胜率、回归概率、买卖信号或仓位建议。合成 CK 仅为价格几何代理。</span>
  </section>
</main>
<script>window.__POOL_REPORT__ = ${serializeForScript(report)};</script>
<script type="module" src="./report-client.js"></script>
</body>
</html>`
}

export function renderLegacyArchiveNotice(contract) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8" /><meta name="robots" content="noindex,nofollow" />
<meta name="viewport" content="width=device-width,initial-scale=1" /><title>历史报告已隔离</title>
<style>body{margin:0;background:#f4f6f8;color:#172033;font:15px/1.65 system-ui,sans-serif}main{max-width:680px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #dfe5ea;border-radius:14px}a{color:#0b6bcb}</style></head>
<body><main><h1>历史报告合同已隔离</h1><p>${escapeHtml(contract.generatedDate)} 的报告不再代表当前筛选合同。</p><a href="../">打开当前报告</a></main></body></html>`
}

function renderSummaryCard(label, value, note) {
  return `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`
}

function renderAgentReview(review, request) {
  if (review.status !== 'reviewed') {
    return `<section class="agent-review pending" id="agent-review" data-review-status="${escapeHtml(review.status)}">
      <div><p class="eyebrow">LLM Agent 结论</p><h2>待 Agent 复核</h2></div>
      <p>${escapeHtml(review.message)}</p>
      <p class="agent-applicability" id="agent-applicability">可使用 ${request.compatibleAgents.map(escapeHtml).join('、')} 读取当前证据合同后生成复核产物。</p>
    </section>`
  }

  const conclusion = review.conclusion
  return `<section class="agent-review reviewed" id="agent-review" data-review-status="reviewed">
    <div class="agent-review-head">
      <div><p class="eyebrow">LLM Agent 结论</p><h2>${escapeHtml(review.agent.name)} 已复核</h2></div>
      <time>${escapeHtml(formatTimestamp(review.generatedAt))}</time>
    </div>
    <p class="agent-summary">${escapeHtml(conclusion.summary)}</p>
    ${renderReviewList('支持证据', conclusion.supportingEvidence)}
    ${renderReviewList('反证', conclusion.counterEvidence)}
    ${renderWatchlist(conclusion.watchlist)}
    ${renderReviewList('下次复核', conclusion.nextReview)}
    <p class="agent-applicability" id="agent-applicability">该结论对应严格门禁原始顺序与当前证据摘要。</p>
  </section>`
}

function renderReviewList(title, items) {
  if (!items.length) return ''
  return `<div class="review-list"><strong>${escapeHtml(title)}</strong><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>`
}

function renderWatchlist(items) {
  if (!items.length) return ''
  const rows = items
    .map((item) => `<li><strong>${escapeHtml(item.symbol)}</strong><span>${escapeHtml(item.note)}</span></li>`)
    .join('')
  return `<div class="review-list"><strong>复核队列</strong><ul>${rows}</ul></div>`
}

function renderDimensionRow(dimension) {
  const checked = dimension.enabled ? 'checked' : ''
  return `<tr data-dimension-row="${escapeHtml(dimension.id)}">
    <td>${escapeHtml(dimension.label)}</td>
    <td><input type="checkbox" data-dimension-enabled="${escapeHtml(dimension.id)}" ${checked} /></td>
    <td><input type="range" min="0" max="50" step="1" value="${escapeHtml(dimension.weight)}" data-dimension-weight="${escapeHtml(dimension.id)}" /><output data-dimension-output="${escapeHtml(dimension.id)}">${escapeHtml(dimension.weight)}</output></td>
  </tr>`
}

function renderStatusSection(report, status) {
  const meta = STATUS_META[status]
  const items = report.candidatesAll.filter((candidate) => candidate.candidateStatus === status)
  const content = items.length
    ? `<ol class="candidate-list" data-status-list="${escapeHtml(status)}">${items.map((item, index) => renderCandidate(item, index, report.topN)).join('')}</ol>`
    : '<p class="empty">本轮没有标的进入该状态。</p>'
  return `<section class="status-group tone-${meta.tone}" data-status-group="${escapeHtml(status)}">
    <header><h2>${escapeHtml(meta.title)}</h2><span><strong data-status-count="${escapeHtml(status)}">${items.length}</strong> 只</span></header>
    ${content}
  </section>`
}

function renderCandidate(candidate, index, topN) {
  const formula = candidate.formula ?? {}
  const cost = formula.cost ?? {}
  const deviation = formula.deviation ?? {}
  const meanReversion = formula.meanReversion ?? {}
  const dynamicHolding = formula.dynamicHolding ?? {}
  const orderPlan = formula.orderPlan ?? {}
  const hidden = index >= topN ? 'hidden' : ''
  const diagnostic = candidate.diagnosticRanking
  const diagnosticPercent = diagnostic.maxScore > 0 ? diagnostic.ratio * 100 : null

  return `<li class="candidate" data-symbol="${escapeHtml(candidate.symbol)}" data-canonical-rank="${escapeHtml(candidate.canonicalRank)}" ${hidden}>
    <div class="candidate-head">
      <span class="rank" data-rank>#${index + 1}</span>
      <div><h3>${escapeHtml(candidate.label)}</h3><p>${escapeHtml(candidate.symbol)} · ${escapeHtml(candidate.market)}</p></div>
      <div class="status-badges">
        <span class="status">${escapeHtml(candidate.candidateStatus)}</span>
        <span class="blocked">执行 ${escapeHtml(candidate.executionStatus)}</span>
      </div>
    </div>
    <div class="score-row">
      <span>严格诊断分 <strong>${escapeHtml(candidate.score)}</strong></span>
      <span>自定义排序分 <strong data-custom-score>${escapeHtml(formatPercent(diagnosticPercent))}</strong></span>
      <span>${escapeHtml(DATA_STATE_LABELS[candidate.dataState] ?? candidate.dataState)}</span>
    </div>
    <dl class="metric-grid">
      ${renderMetric('收盘价', formatNumber(candidate.close, 2))}
      ${renderMetric('成本锚', formatNumber(cost.anchor, 2))}
      ${renderMetric('距锚', formatSignedPercent(cost.distancePct))}
      ${renderMetric('z 偏离', formatSigma(deviation.z))}
      ${renderMetric('AR 半衰期', formatSessions(meanReversion.halfLifeSessions))}
      ${renderMetric('动态阶段', dynamicHolding.phaseLabel ?? '—')}
    </dl>
    <p class="reason"><strong>门禁原因</strong>${escapeHtml(reasonText(candidate.statusReasons))}</p>
    <p class="reason"><strong>结构阻断</strong>${escapeHtml(reasonText(dynamicHolding.blockedReasons))}</p>
    <p class="reason"><strong>计划阻断</strong>${escapeHtml(reasonText(orderPlan.blockedReasons))}</p>
    <p class="provenance">${escapeHtml(candidate.source)} · 截止 ${escapeHtml(candidate.dataThrough)} · ${escapeHtml(candidate.rows)} 行 · stale ${escapeHtml(candidate.staleDays)} 天</p>
  </li>`
}

function renderMetric(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
}

function reasonText(items) {
  if (!Array.isArray(items) || !items.length) return '无'
  return items.map((item) => REASON_LABELS[item] ?? item).join('；')
}

function formatTimestamp(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value ?? '—')
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatNumber(value, digits) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : '—'
}

function formatSignedPercent(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  const sign = number > 0 ? '+' : ''
  return `${sign}${number.toFixed(2)}%`
}

function formatSigma(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(2)}σ` : '—'
}

function formatSessions(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(1)} 会话` : '—'
}

function formatPercent(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(1)}%` : '—'
}

function serializeForScript(value) {
  return JSON.stringify(value).replaceAll('</', '<\\/').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
