#!/usr/bin/env node
/**
 * CQRS 组件单向数据流守门员（含 --self-test 负样本必红校验）：
 * Vue 展示组件禁止通过 v-model="input.xxx" / "featureFlags.xxx" / "overlays.xxx"
 * 或直接对 props.input 赋值穿透篡改 Store 状态，所有输入变更必须走显式 Command 事件。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src/components'
const EXTENSIONS = new Set(['.vue', '.js'])

const FORBIDDEN_PATTERNS = [
  {
    pattern: /\bv-model(?:\.[A-Za-z0-9_]+)*\s*=\s*['"](?:input|featureFlags|overlays)\./,
    label: 'v-model-store-prop-mutation',
  },
  { pattern: /\b(?:props\.)?input\.[A-Za-z0-9_]+\s*(?<![=!<>])=(?!=)/, label: 'direct-props-input-assign' },
  { pattern: /\b(?:props\.)?input\[[^\]]+\]\s*(?<![=!<>])=(?!=)/, label: 'bracket-props-input-assign' },
]

// 历史违规已全部清零，严禁新增任何豁免
const LEGACY_ALLOWLIST = new Set()

export function inspectComponent(filePath, content, { allowLegacy = true } = {}) {
  const normalizedPath = filePath.replaceAll('\\', '/')
  if (normalizedPath.includes('/__tests__/') || /\.test\.[cm]?js$/.test(normalizedPath)) return []
  if (allowLegacy && LEGACY_ALLOWLIST.has(normalizedPath)) return []

  const violations = []
  content.split('\n').forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('<!--')) return
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.pattern.test(line)) {
        violations.push({ path: normalizedPath, line: index + 1, label: rule.label, text: trimmed })
      }
    }
  })
  return violations
}

function runSelfTest() {
  assert.equal(
    inspectComponent('src/components/Fake.vue', '<input v-model.number="input.capital" />', { allowLegacy: false })
      .length,
    1,
    'must reject v-model on input prop',
  )
  assert.equal(
    inspectComponent('src/components/Fake.vue', '<input v-model="featureFlags.replayAccount" />', {
      allowLegacy: false,
    }).length,
    1,
    'must reject v-model on featureFlags prop',
  )
  assert.equal(
    inspectComponent('src/components/Fake.vue', 'props.input.strikePrice = 100', { allowLegacy: false }).length,
    1,
    'must reject direct props.input property assignment',
  )
  assert.equal(
    inspectComponent('src/components/Fake.vue', "input['iv'] = 0.3", { allowLegacy: false }).length,
    1,
    'must reject bracket input assignment',
  )
  assert.equal(
    inspectComponent('src/components/Fake.vue', 'const enabled = props.input.lpScenarioEnabled === true', {
      allowLegacy: false,
    }).length,
    0,
    'equality comparison must pass',
  )
}

if (process.argv.includes('--self-test')) {
  runSelfTest()
  console.log('cqrs boundary self-test passed (negative samples rejected)')
}

const offenders = []
scan(ROOT)

if (offenders.length) {
  console.error('src/components/ CQRS unidirectional flow check failed:')
  for (const o of offenders) {
    console.error(`- ${o.path}:${o.line}  [forbidden: ${o.label}]  ${o.text}`)
  }
  process.exit(1)
}

console.log(`cqrs boundary check passed (${ROOT}, legacy allowlist: ${LEGACY_ALLOWLIST.size})`)

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      scan(fullPath)
      continue
    }
    const dot = fullPath.lastIndexOf('.')
    const ext = dot >= 0 ? fullPath.slice(dot) : ''
    if (!EXTENSIONS.has(ext)) continue
    offenders.push(...inspectComponent(fullPath, readFileSync(fullPath, 'utf8')))
  }
}
