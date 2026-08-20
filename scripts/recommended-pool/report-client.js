import { rankWithinCandidateStatus } from './report-ranking.js'

const report = window.__POOL_REPORT__
const storageKey = 'marketLab.recommendedPool.config.v2'
const defaultDimensions = report.rankingPolicy.dimensions.map((dimension) => ({ ...dimension }))
const defaultConfig = Object.freeze({
  mode: report.rankingPolicy.defaultMode,
  displayLimit: report.topN,
  dimensions: defaultDimensions,
})
const state = restoreConfig(defaultConfig)

const modeControl = document.querySelector('#ranking-mode')
const limitControl = document.querySelector('#display-limit')
const resetControl = document.querySelector('#reset-config')
const copyAgentTaskControl = document.querySelector('#copy-agent-task')
const configState = document.querySelector('#config-state')
const agentApplicability = document.querySelector('#agent-applicability')

modeControl.value = state.mode
limitControl.value = state.displayLimit
syncDimensionControls()
render()

modeControl.addEventListener('change', () => {
  state.mode = modeControl.value
  persistAndRender()
})

limitControl.addEventListener('change', () => {
  state.displayLimit = boundedInteger(limitControl.value, 1, report.totalCandidates, report.topN)
  limitControl.value = state.displayLimit
  persistAndRender()
})

document.querySelectorAll('[data-dimension-enabled]').forEach((control) => {
  control.addEventListener('change', () => {
    updateDimension(control.dataset.dimensionEnabled, { enabled: control.checked })
  })
})

document.querySelectorAll('[data-dimension-weight]').forEach((control) => {
  control.addEventListener('input', () => {
    updateDimension(control.dataset.dimensionWeight, { weight: boundedNumber(control.value, 0, 50, 0) })
  })
})

resetControl.addEventListener('click', () => {
  state.mode = defaultConfig.mode
  state.displayLimit = defaultConfig.displayLimit
  state.dimensions = defaultConfig.dimensions.map((dimension) => ({ ...dimension }))
  modeControl.value = state.mode
  limitControl.value = state.displayLimit
  syncDimensionControls()
  persistAndRender()
})

copyAgentTaskControl.addEventListener('click', async () => {
  const task = buildAgentTask()
  const writeTask = navigator.clipboard?.writeText?.bind(navigator.clipboard)
  if (!writeTask) {
    copyAgentTaskControl.textContent = '当前环境不支持复制，请打开 data.json'
    return
  }
  await writeTask(JSON.stringify(task, null, 2))
  copyAgentTaskControl.textContent = '已复制复核任务'
  window.setTimeout(() => {
    copyAgentTaskControl.textContent = '复制 LLM Agent 复核任务'
  }, 1800)
})

function updateDimension(id, patch) {
  state.dimensions = state.dimensions.map((dimension) => (dimension.id === id ? { ...dimension, ...patch } : dimension))
  state.mode = 'custom'
  modeControl.value = state.mode
  syncDimensionControls()
  persistAndRender()
}

function render() {
  document.querySelectorAll('[data-status-list]').forEach((list) => {
    const status = list.dataset.statusList
    const candidates = report.candidatesAll.filter((candidate) => candidate.candidateStatus === status)
    renderStatusGroup(status, candidates)
  })

  const modeLabels = {
    canonical: '严格门禁原始顺序',
    custom: '自定义诊断排序',
  }
  configState.textContent = `${modeLabels[state.mode]} · 每组展示 ${state.displayLimit} 只 · 状态与执行门禁保持不变`
  agentApplicability.textContent = agentApplicabilityText(state.mode, report.agentReview.status)
  document.querySelector('#agent-review').dataset.rankingMode = state.mode
}

function renderStatusGroup(status, candidates) {
  const list = document.querySelector(`[data-status-list="${status}"]`)
  if (!list) return

  const sorted = rankWithinCandidateStatus(candidates, state)
  sorted.forEach(({ candidate, customScore: score }, index) => {
    const element = list.querySelector(`[data-symbol="${candidate.symbol}"]`)
    if (!element) return
    element.hidden = index >= state.displayLimit
    element.querySelector('[data-rank]').textContent = `#${index + 1}`
    element.querySelector('[data-custom-score]').textContent = formatPercent(score * 100)
    list.append(element)
  })
}

function buildAgentTask() {
  const visibleByStatus = Object.fromEntries(
    [...document.querySelectorAll('[data-status-list]')].map((list) => [
      list.dataset.statusList,
      [...list.querySelectorAll('.candidate:not([hidden])')].map((element) => {
        const candidate = report.candidatesAll.find((item) => item.symbol === element.dataset.symbol)
        return {
          symbol: candidate.symbol,
          label: candidate.label,
          candidateStatus: candidate.candidateStatus,
          executionStatus: candidate.executionStatus,
          statusReasons: candidate.statusReasons,
          dataThrough: candidate.dataThrough,
          formula: {
            cost: candidate.formula.cost,
            deviation: candidate.formula.deviation,
            meanReversion: candidate.formula.meanReversion,
            dynamicHolding: candidate.formula.dynamicHolding,
            orderPlan: candidate.formula.orderPlan,
          },
        }
      }),
    ]),
  )

  return {
    task: 'review-market-lab-recommended-pool',
    request: report.agentReviewRequest,
    rankingConfig: structuredClone(state),
    canonicalSummary: report.canonicalSummary,
    visibleByStatus,
  }
}

function agentApplicabilityText(mode, reviewStatus) {
  const messages = {
    canonical: {
      reviewed: '该 Agent 结论对应严格门禁原始顺序与当前证据摘要。',
      pending: '当前证据尚未由 LLM Agent 复核，页面不会自行补写结论。',
      'stale-or-invalid': '已有 Agent 产物与当前证据不匹配，页面未采用其结论。',
    },
    custom: {
      reviewed: '当前已切换自定义排序；既有 Agent 结论只适用于默认顺序，请复制任务并重新调用 Agent。',
      pending: '当前自定义排序尚未调用 LLM Agent，页面只展示确定性证据。',
      'stale-or-invalid': '当前自定义排序没有匹配的 Agent 复核产物。',
    },
  }
  return messages[mode]?.[reviewStatus] ?? '当前配置尚未获得匹配的 Agent 复核。'
}

function syncDimensionControls() {
  state.dimensions.forEach((dimension) => {
    const enabled = document.querySelector(`[data-dimension-enabled="${dimension.id}"]`)
    const weight = document.querySelector(`[data-dimension-weight="${dimension.id}"]`)
    const output = document.querySelector(`[data-dimension-output="${dimension.id}"]`)
    if (enabled) enabled.checked = dimension.enabled
    if (weight) weight.value = dimension.weight
    if (output) output.textContent = dimension.weight
  })
}

function restoreConfig(fallback) {
  const saved = readSavedConfig()
  if (!saved) return structuredClone(fallback)
  const dimensionById = new Map(saved.dimensions?.map((dimension) => [dimension.id, dimension]) ?? [])
  return {
    mode: ['canonical', 'custom'].includes(saved.mode) ? saved.mode : fallback.mode,
    displayLimit: boundedInteger(saved.displayLimit, 1, report.totalCandidates, fallback.displayLimit),
    dimensions: fallback.dimensions.map((dimension) => normalizeSavedDimension(dimension, dimensionById)),
  }
}

function normalizeSavedDimension(fallback, dimensionById) {
  const saved = dimensionById.get(fallback.id) ?? {}
  return {
    ...fallback,
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : fallback.enabled,
    weight: boundedNumber(saved.weight, 0, 50, fallback.weight),
  }
}

function readSavedConfig() {
  try {
    return JSON.parse(localStorage.getItem(storageKey))
  } catch {
    return null
  }
}

function persistAndRender() {
  localStorage.setItem(storageKey, JSON.stringify(state))
  render()
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
