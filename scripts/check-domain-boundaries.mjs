#!/usr/bin/env node
/**
 * 架构边界守门员（含 --self-test 负样本必红校验）：
 * 1. src/domain/（含测试）禁止依赖 Vue、Pinia、图表库、jQuery 等外部 UI/渲染包。
 * 2. src/domain/（含测试）禁止反向引用 src/{components,composables,stores,infrastructure,canvas}。
 * 3. src/domain/ 禁止直接访问浏览器运行时全局对象（document/localStorage/sessionStorage/fetch/XMLHttpRequest）。
 * 4. src/domain/market-data/ 纯行情事实层禁止反向依赖 formulas/formula-research/lp/strategy-planning/replay/research-visualization/workbench。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const ROOT = 'src/domain'
const EXTENSIONS = new Set(['.js', '.mjs', '.vue'])

const FORBIDDEN_IMPORTS = [
  { pattern: /\bfrom\s+['"]vue(?:\/[^'"]*)?['"]/, label: 'vue' },
  { pattern: /\bfrom\s+['"]@vue\/[^'"]*['"]/, label: '@vue/*' },
  { pattern: /\bfrom\s+['"]pinia['"]/, label: 'pinia' },
  { pattern: /\bfrom\s+['"]lightweight-charts['"]/, label: 'lightweight-charts' },
  { pattern: /\bfrom\s+['"]hqchart(?:\/[^'"]*)?['"]/, label: 'hqchart' },
  { pattern: /\bfrom\s+['"]@luxalgo\/vela(?:-pinets)?(?:\/[^'"]*)?['"]/, label: 'vela' },
  { pattern: /\bfrom\s+['"]pinets(?:\/[^'"]*)?['"]/, label: 'pinets' },
  { pattern: /\bfrom\s+['"]jquery(?:\/[^'"]*)?['"]/, label: 'jquery' },
  {
    pattern: /\bimport\(\s*['"](?:vue|pinia|lightweight-charts|hqchart|@luxalgo\/vela|pinets|jquery)/,
    label: 'dynamic-ui-lib',
  },
]

const FORBIDDEN_GLOBALS = [
  { pattern: /\b(?:document|localStorage|sessionStorage)\s*\./, label: 'browser-dom-storage' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { pattern: /\bfetch\s*\(/, label: 'fetch' },
]

const FORBIDDEN_MARKET_DATA_TARGETS = new Set([
  'formulas',
  'formula-research',
  'lp',
  'strategy-planning',
  'planning',
  'replay',
  'research-visualization',
  'workbench',
  'market-impact',
])

// 历史违规已全部清零，严禁新增任何豁免
const LEGACY_ALLOWLIST = new Set()

export function inspectSource(filePath, content, { allowLegacy = true } = {}) {
  const normalizedPath = filePath.replaceAll('\\', '/')
  const bc = normalizedPath.split('/')[2] ?? ''
  const isTest = normalizedPath.includes('/__tests__/') || /\.test\.[cm]?js$/.test(normalizedPath)
  const violations = []
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

    for (const rule of FORBIDDEN_IMPORTS) {
      if (rule.pattern.test(line)) {
        violations.push({ path: normalizedPath, line: index + 1, label: rule.label, text: trimmed })
      }
    }

    if (!isTest) {
      for (const rule of FORBIDDEN_GLOBALS) {
        if (rule.pattern.test(line)) {
          violations.push({ path: normalizedPath, line: index + 1, label: rule.label, text: trimmed })
        }
      }
    }

    for (const match of line.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
      const target = normalize(join(dirname(normalizedPath), match[1])).replaceAll('\\', '/')
      if (/^src\/(?:components|composables|stores|infrastructure|canvas)(?:\/|$)/.test(target)) {
        const key = `${normalizedPath}::upper-layer`
        if (!allowLegacy || !LEGACY_ALLOWLIST.has(key)) {
          violations.push({ path: normalizedPath, line: index + 1, label: 'upper-layer', text: trimmed })
        }
      }
      if (!isTest && bc === 'market-data' && target.startsWith('src/domain/')) {
        const targetBc = target.split('/')[2] ?? ''
        if (FORBIDDEN_MARKET_DATA_TARGETS.has(targetBc)) {
          const key = `${normalizedPath}::market-data->${targetBc}`
          if (!allowLegacy || !LEGACY_ALLOWLIST.has(key)) {
            violations.push({
              path: normalizedPath,
              line: index + 1,
              label: `market-data->${targetBc}`,
              text: trimmed,
            })
          }
        }
      }
    }
  })

  return violations
}

function runSelfTest() {
  assert.equal(
    inspectSource('src/domain/formulas/fake.js', "import { ref } from 'vue'\n", { allowLegacy: false }).length,
    1,
    'must catch vue import in domain',
  )
  assert.equal(
    inspectSource(
      'src/domain/__tests__/fake.test.js',
      "import { x } from '../../infrastructure/charting/velaChartAdapter.js'\n",
      { allowLegacy: false },
    ).length,
    1,
    'must catch domain->infrastructure reverse import',
  )
  assert.equal(
    inspectSource('src/domain/market-data/fake.js', "import { getDeltaBands } from '../formulas/core.js'\n", {
      allowLegacy: false,
    }).length,
    1,
    'must catch market-data->formulas reverse import',
  )
  assert.equal(
    inspectSource('src/domain/formulas/fake.js', "const raw = localStorage.getItem('k')\n", { allowLegacy: false })
      .length,
    1,
    'must catch browser storage in domain',
  )
  assert.equal(
    inspectSource('src/domain/market-data/clean.js', 'export const x = (rows) => rows.length\n', {
      allowLegacy: false,
    }).length,
    0,
    'clean domain module must pass',
  )
}

if (process.argv.includes('--self-test')) {
  runSelfTest()
  console.log('domain boundary self-test passed (negative samples rejected)')
}

const offenders = []
scan(ROOT)

if (offenders.length) {
  console.error('src/domain/ boundary check failed (see AGENTS.md & docs/bounded-context-map.md):')
  for (const o of offenders) {
    console.error(`- ${o.path}:${o.line}  [forbidden: ${o.label}]  ${o.text}`)
  }
  process.exit(1)
}

console.log(`domain boundary check passed (${ROOT}, legacy allowlist: ${LEGACY_ALLOWLIST.size})`)

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
    offenders.push(...inspectSource(fullPath, readFileSync(fullPath, 'utf8')))
  }
}
