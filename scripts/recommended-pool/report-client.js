import {
  normalizeRecommendedPoolQueryConfig,
  recommendedPoolQueryDigestPayload,
  runRecommendedPoolQuery,
} from './report-query.js'

const report = window.__POOL_REPORT__
const storageKey = 'marketLab.recommendedPool.config.v3'
const policyDimensions = report.rankingPolicy.dimensions.map((dimension) => ({ ...dimension }))
const defaultConfig = normalizeRecommendedPoolQueryConfig(
  {
    dimensions: policyDimensions,
    thresholds: report.queryPolicy.defaultThresholds,
    displayLimit: report.topN,
  },
  policyDimensions,
)
const restored = restoreConfig(defaultConfig)
const state = restored.config
const controls = bindControls()
let activeQueryResult = null
let activeQueryDigest = null
let renderRevision = 0
let configWarning = restored.warning

syncControls()
render()

controls.displayLimit.addEventListener('input', () => {
  state.displayLimit = boundedInteger(controls.displayLimit.value, 1, report.totalCandidates, report.topN)
  persistAndRender()
})

Object.entries(controls.thresholds).forEach(([id, control]) => {
  control.addEventListener('input', () => {
    const thresholds = {
      ...state.thresholds,
      [id]: boundedNumber(control.value, 0, 100, state.thresholds[id] * 100) / 100,
    }
    state.thresholds = normalizeRecommendedPoolQueryConfig({ ...state, thresholds }, policyDimensions).thresholds
    persistAndRender()
  })
})

controls.dimensionEnabled.forEach((control) => {
  control.addEventListener('change', () => {
    updateDimension(control.dataset.dimensionEnabled, { enabled: control.checked })
  })
})

controls.dimensionWeights.forEach((control) => {
  control.addEventListener('input', () => {
    updateDimension(control.dataset.dimensionWeight, {
      weight: boundedNumber(control.value, 0, 50, 0),
    })
  })
})

controls.reset.addEventListener('click', () => {
  Object.assign(state, structuredClone(defaultConfig))
  configWarning = ''
  clearQueryParameters()
  localStorage.removeItem(storageKey)
  syncControls()
  render()
})

controls.copyAgentTask.addEventListener('click', async () => {
  const task = await buildAgentTask()
  const writeTask = navigator.clipboard?.writeText?.bind(navigator.clipboard)
  if (!writeTask) {
    controls.copyAgentTask.textContent = '当前环境不支持复制，请打开 data.json'
    return
  }
  await writeTask(JSON.stringify(task, null, 2))
  controls.copyAgentTask.textContent = '已复制当前函数复核任务'
  window.setTimeout(() => {
    controls.copyAgentTask.textContent = '复制当前配置给 LLM Agent'
  }, 1800)
})

function bindControls() {
  return {
    displayLimit: document.querySelector('#display-limit'),
    reset: document.querySelector('#reset-config'),
    copyAgentTask: document.querySelector('#copy-agent-task'),
    configState: document.querySelector('#config-state'),
    queryDigest: document.querySelector('#query-digest'),
    dimensionEnabled: [...document.querySelectorAll('[data-dimension-enabled]:not(:disabled)')],
    dimensionWeights: [...document.querySelectorAll('[data-dimension-weight]:not(:disabled)')],
    thresholds: Object.fromEntries(
      [...document.querySelectorAll('[data-query-threshold]')].map((control) => [
        control.dataset.queryThreshold,
        control,
      ]),
    ),
  }
}

function updateDimension(id, patch) {
  const requested = state.dimensions.map((dimension) => (dimension.id === id ? { ...dimension, ...patch } : dimension))
  state.dimensions = normalizeRecommendedPoolQueryConfig(
    { ...state, dimensions: requested },
    policyDimensions,
  ).dimensions
  persistAndRender()
}

function render() {
  const normalized = normalizeRecommendedPoolQueryConfig(state, policyDimensions)
  Object.assign(state, normalized)
  activeQueryResult = runRecommendedPoolQuery(report.candidatesAll, state, policyDimensions)
  renderCanonicalGroups()
  renderQueryGroups(activeQueryResult)
  syncControls()

  const counts = activeQueryResult.counts
  const activeDimensionCount = state.dimensions.filter(
    (dimension) => dimension.queryMutable && dimension.enabled && dimension.weight > 0,
  ).length
  const dimensionWarning = activeDimensionCount === 0 ? '无有效诊断维度' : ''
  const summaryParts = [
    configWarning,
    dimensionWarning,
    `函数结果：优先复核 ${counts['priority-review']}`,
    `次级复核 ${counts['secondary-review']}`,
    `阈值外 ${counts['below-threshold']}`,
    `门禁隔离 ${counts['canonical-gate']}`,
    'canonical 状态与执行门禁未变',
  ].filter(Boolean)
  controls.configState.textContent = `${summaryParts.join(' · ')}。`
  updateQueryDigest(activeQueryResult, ++renderRevision)
}

function renderCanonicalGroups() {
  const queryRowBySymbol = new Map(activeQueryResult.rows.map((row) => [row.candidate.symbol, row]))
  document.querySelectorAll('[data-status-list]').forEach((list) => {
    const candidates = report.candidatesAll.filter((candidate) => candidate.candidateStatus === list.dataset.statusList)
    candidates.forEach((candidate, index) => {
      const element = list.querySelector(`[data-symbol="${candidate.symbol}"]`)
      if (!element) return
      element.hidden = index >= state.displayLimit
      element.querySelector('[data-rank]').textContent = `#${index + 1}`
      element.querySelector('[data-custom-score]').textContent = formatPercent(
        queryRowBySymbol.get(candidate.symbol)?.diagnostic.ratio * 100,
      )
      list.append(element)
    })
  })
}

function renderQueryGroups(result) {
  document.querySelectorAll('[data-query-list]').forEach((list) => {
    const band = list.dataset.queryList
    const rows = result.groups[band] ?? []
    list.replaceChildren(...rows.slice(0, state.displayLimit).map(renderQueryCandidate))
    const empty = document.querySelector(`[data-query-empty="${band}"]`)
    empty.hidden = rows.length > 0
    document.querySelector(`[data-query-count="${band}"]`).textContent = rows.length
  })
}

function renderQueryCandidate(row, index) {
  const item = document.createElement('li')
  item.className = 'query-candidate'
  const head = document.createElement('div')
  head.className = 'query-candidate-head'
  const identity = document.createElement('div')
  const title = document.createElement('strong')
  const meta = document.createElement('span')
  const badges = document.createElement('div')
  const status = document.createElement('span')
  const execution = document.createElement('span')
  const score = document.createElement('strong')

  title.textContent = `#${index + 1} ${row.candidate.label}`
  meta.textContent = `${row.candidate.symbol} · 截止 ${row.candidate.dataThrough}`
  status.className = 'status'
  status.textContent = row.candidate.candidateStatus
  execution.className = 'blocked'
  execution.textContent = `执行 ${row.candidate.executionStatus}`
  score.className = 'query-score'
  score.textContent = formatPercent(row.diagnostic.ratio * 100)
  identity.append(title, meta)
  badges.append(status, execution)
  head.append(identity, score, badges)
  item.append(head)
  return item
}

async function updateQueryDigest(result, revision) {
  activeQueryDigest = null
  controls.queryDigest.textContent = '当前配置摘要计算中…'
  const payload = recommendedPoolQueryDigestPayload(report.evidenceDigest, result)
  const digest = await sha256Hex(JSON.stringify(payload))
  if (revision !== renderRevision) return
  activeQueryDigest = digest
  controls.queryDigest.textContent = `当前函数配置 ${digest.slice(0, 12)}… 尚未由 LLM Agent 复核。`
}

async function buildAgentTask() {
  const queryPayload = recommendedPoolQueryDigestPayload(report.evidenceDigest, activeQueryResult)
  const queryDigest = activeQueryDigest ?? (await sha256Hex(JSON.stringify(queryPayload)))
  const visibleResults = Object.fromEntries(
    Object.entries(activeQueryResult.groups).map(([band, rows]) => [
      band,
      rows.slice(0, state.displayLimit).map(({ candidate, diagnostic }) => ({
        symbol: candidate.symbol,
        label: candidate.label,
        candidateStatus: candidate.candidateStatus,
        executionStatus: candidate.executionStatus,
        statusReasons: candidate.statusReasons,
        executionReasons: candidate.executionReasons,
        dataThrough: candidate.dataThrough,
        diagnosticRatio: diagnostic.ratio,
        contributions: diagnostic.contributions,
        formula: {
          cost: candidate.formula.cost,
          deviation: candidate.formula.deviation,
          meanReversion: candidate.formula.meanReversion,
          dynamicHolding: candidate.formula.dynamicHolding,
          orderPlan: candidate.formula.orderPlan,
        },
      })),
    ]),
  )

  return {
    task: 'review-market-lab-recommended-pool-query',
    request: {
      ...report.queryReviewRequest,
      evidenceDigest: report.evidenceDigest,
      queryDigest,
    },
    canonicalSummary: report.canonicalSummary,
    queryPayload,
    visibleResults,
  }
}

function syncControls() {
  controls.displayLimit.value = state.displayLimit
  Object.entries(controls.thresholds).forEach(([id, control]) => {
    control.value = Math.round(state.thresholds[id] * 100)
  })
  state.dimensions.forEach((dimension) => {
    document.querySelectorAll(`[data-dimension-enabled="${dimension.id}"]`).forEach((control) => {
      control.checked = dimension.rangeCondition || dimension.enabled
    })
    document.querySelectorAll(`[data-dimension-weight="${dimension.id}"]`).forEach((control) => {
      control.value = dimension.weight
    })
  })
}

function restoreConfig(fallback) {
  try {
    const source = readUrlConfig(fallback) ?? readSavedConfig()
    if (!source) return { config: structuredClone(fallback), warning: '' }
    return {
      config: normalizeRecommendedPoolQueryConfig(
        {
          dimensions: mergeSavedDimensions(fallback.dimensions, source.dimensions),
          thresholds: source.thresholds,
          displayLimit: source.displayLimit,
        },
        policyDimensions,
      ),
      warning: '',
    }
  } catch {
    return { config: structuredClone(fallback), warning: 'URL 或本地配置无效，已恢复默认' }
  }
}

function readUrlConfig(fallback) {
  const params = new URL(window.location.href).searchParams
  const relevant = ['enabled', 'weights', 'priority', 'secondary', 'focus', 'wait', 'limit']
  if (!relevant.some((key) => params.has(key))) return null
  const enabled = params.has('enabled') ? params.get('enabled').split(',').filter(Boolean) : null
  const weightEntries = params.has('weights') ? params.get('weights').split(',').filter(Boolean) : []
  const weights = weightEntries.map(parseWeightEntry)
  const requestedIds = new Set([...(enabled ?? []), ...weights.map((entry) => entry.id)])
  const allowedIds = new Set(
    fallback.dimensions.filter((dimension) => dimension.queryMutable).map((dimension) => dimension.id),
  )
  const invalidId = [...requestedIds].find((id) => !allowedIds.has(id))
  const duplicateEnabled = enabled && new Set(enabled).size !== enabled.length
  const duplicateWeights = new Set(weights.map((entry) => entry.id)).size !== weights.length
  if (invalidId || duplicateEnabled || duplicateWeights) {
    throw new TypeError('invalid query URL dimensions')
  }
  const weightById = new Map(weights.map((entry) => [entry.id, entry.weight]))
  const enabledSet = enabled ? new Set(enabled) : null
  return {
    dimensions: fallback.dimensions.map((dimension) => ({
      ...dimension,
      enabled: enabledSet && dimension.queryMutable ? enabledSet.has(dimension.id) : dimension.enabled,
      weight: weightById.get(dimension.id) ?? dimension.weight,
    })),
    thresholds: {
      priorityReviewMin: percentParameter(params, ['priority', 'focus'], fallback.thresholds.priorityReviewMin),
      secondaryReviewMin: percentParameter(params, ['secondary', 'wait'], fallback.thresholds.secondaryReviewMin),
    },
    displayLimit: params.get('limit') ?? fallback.displayLimit,
  }
}

function parseWeightEntry(entry) {
  const [id, rawWeight, extra] = entry.split(':')
  const weight = Number(rawWeight)
  if (!id || extra !== undefined || !Number.isFinite(weight) || weight < 0 || weight > 50) {
    throw new TypeError('invalid query URL weight')
  }
  return { id, weight }
}

function percentParameter(params, aliases, fallback) {
  const key = aliases.find((name) => params.has(name))
  if (!key) return fallback
  const percentage = Number(params.get(key))
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new TypeError('invalid query URL threshold')
  }
  return percentage / 100
}

function readSavedConfig() {
  try {
    return JSON.parse(localStorage.getItem(storageKey))
  } catch {
    return null
  }
}

function mergeSavedDimensions(fallbackDimensions, savedDimensions = []) {
  const savedById = new Map(savedDimensions.map((dimension) => [dimension.id, dimension]))
  return fallbackDimensions.map((dimension) => ({
    ...dimension,
    ...(savedById.get(dimension.id) ?? {}),
  }))
}

function persistAndRender() {
  configWarning = ''
  localStorage.setItem(storageKey, JSON.stringify(state))
  writeQueryParameters(state)
  syncControls()
  render()
}

function writeQueryParameters(config) {
  const url = new URL(window.location.href)
  const mutable = config.dimensions.filter((dimension) => dimension.queryMutable)
  url.searchParams.set(
    'enabled',
    mutable
      .filter((dimension) => dimension.enabled)
      .map((dimension) => dimension.id)
      .join(','),
  )
  url.searchParams.set('weights', mutable.map((dimension) => `${dimension.id}:${dimension.weight}`).join(','))
  url.searchParams.set('priority', String(Math.round(config.thresholds.priorityReviewMin * 100)))
  url.searchParams.set('secondary', String(Math.round(config.thresholds.secondaryReviewMin * 100)))
  url.searchParams.set('limit', String(config.displayLimit))
  window.history.replaceState(null, '', url)
}

function clearQueryParameters() {
  const url = new URL(window.location.href)
  const queryParameterNames = ['enabled', 'weights', 'priority', 'secondary', 'focus', 'wait', 'limit']
  queryParameterNames.forEach((key) => url.searchParams.delete(key))
  window.history.replaceState(null, '', url)
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function boundedInteger(value, minimum, maximum, fallback) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function boundedNumber(value, minimum, maximum, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '—'
}
