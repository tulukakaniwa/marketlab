#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const CLAIM_CLASS_ENUM = new Set([
  'exact-identity',
  'sample-estimate',
  'calibrated-estimate',
  'scenario-proxy',
  'missing-input',
])

const canonicalScripts = [
  '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  '.agents/skills/china-stock-selection/scripts/selection-helpers.mjs',
]

const wrappers = [
  {
    path: 'skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
    target: '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  },
  {
    path: 'skills/china-stock-selection/scripts/replay-short-hold.mjs',
    target: '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  },
  {
    path: 'skills/china-stock-selection/scripts/selection-helpers.mjs',
    target: '.agents/skills/china-stock-selection/scripts/selection-helpers.mjs',
  },
  {
    path: '.claude/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
    target: '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  },
  {
    path: '.claude/skills/china-stock-selection/scripts/replay-short-hold.mjs',
    target: '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  },
  {
    path: '.claude/skills/china-stock-selection/scripts/selection-helpers.mjs',
    target: '.agents/skills/china-stock-selection/scripts/selection-helpers.mjs',
  },
]

const skillDocs = [
  '.agents/skills/china-stock-selection/SKILL.md',
  'skills/china-stock-selection/SKILL.md',
  '.claude/skills/china-stock-selection/SKILL.md',
]

const canonicalReferences = [
  '.agents/skills/china-stock-selection/references/retail-decision-contract.md',
  '.agents/skills/china-stock-selection/references/formula-risk-contract.md',
  '.agents/skills/china-stock-selection/references/cli-contract.md',
]

for (const path of canonicalScripts) syntaxCheck(path)

for (const { path, target } of wrappers) {
  const source = read(path)
  assert.match(source, new RegExp(escapeRegExp(target)), `${path} must delegate to ${target}`)
  syntaxCheck(path)
}

for (const path of skillDocs) {
  const source = read(path)
  assert.match(
    source,
    /Canonical implementation: `\.agents\/skills\/china-stock-selection`|sole semantic and safety contract/,
  )
  assert.match(
    source,
    /probabilitySemantics|not (?:a )?(?:future )?(?:mean-)?reversion probability|not a probability that price will revert|不是未来回归概率/i,
  )
  assert.match(source, /synthetic CK geometry/i)
}

for (const path of canonicalReferences) {
  assert.ok(existsSync(resolve(path)), `${path} must exist`)
}

const canonicalSkill = read('.agents/skills/china-stock-selection/SKILL.md')
for (const path of canonicalReferences) {
  const name = path.split('/references/').at(-1)
  assert.ok(canonicalSkill.includes(`references/${name}`), `canonical SKILL.md must route to references/${name}`)
}

const cliContract = read('.agents/skills/china-stock-selection/references/cli-contract.md')
assertTokens(
  cliContract,
  [
    'china-stock-selection.screen.v1',
    'china-stock-selection.replay.v1',
    'scoreStatus',
    'dataState',
    'candidateStatus',
    'status',
    'statusReasons',
    'executionStatus',
    'schemaVersion',
    'stateContract',
    'claimClassContract',
    'claimClasses',
    'provenance',
    'filters',
    'freshness',
    'audit',
    'historical-realized-scenario',
    'isMarketIv=false',
    'startIndex=260',
    'nextAllowedIndex',
    '260 earlier rows',
    'signal-context-frozen-target-recomputed-with-next-session-open',
    'cost-band-deviation-half-life-and-drawdown-frozen-at-signal-close',
    'stop-first-conservative-when-both-hit',
    'feeAppliedToReturns=false',
    'round-trip drag',
    'Hong Kong',
    'same-day',
    'bid/ask',
    'slippage',
    'stamp duty',
    'Unmodeled Execution and Cost Mechanisms',
    'grossReturn',
    'netReturn',
    'feeRate',
    'eligible=true',
    'research-only',
    'Supplied numeric overrides are strict',
    'Unknown flag names',
  ],
  'CLI contract',
)

const screenSource = read('.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs')
assertTokens(
  screenSource,
  [
    'china-stock-selection.screen.v1',
    'scoreStatus',
    'dataState',
    'dataStateReasons',
    'candidateStatus',
    'status',
    'statusReasons',
    'executionStatus',
    'executionReasons',
    'nameSource',
    'source',
    'dataThrough',
    'rows',
    'staleDays',
    'freshness',
    'provenance',
    'filters',
    'audit',
    'skipped',
    'researchBoundary',
    'stateContract',
    'claimClassContract',
    'claimClasses',
    'historical-realized-scenario',
    'isMarketIv',
    'missingInputs',
    'syntheticCkGeometry',
    'orderPlan',
    'blockedReasons',
    'capitalEfficiencyValuationBasis',
    'capitalEfficiencyAtArithmeticCenterMultiple',
    'fullRangeV2IlProxyPct',
    'fullRangeV2IlProxyBasis',
    'candidateStatusPriority',
    'phase-${phase',
  ],
  'screen runtime',
)

const replaySource = read('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs')
assertTokens(
  replaySource,
  [
    'china-stock-selection.replay.v1',
    'STRICT_DEFAULTS',
    'SWING_DEFAULTS',
    'strict',
    'swing',
    'combo',
    'signalDate',
    'entryDate',
    'exitDate',
    'nameSource',
    'source',
    'dataThrough',
    'rows',
    'staleDays',
    'freshness',
    'provenance',
    'filters',
    'audit',
    'skipped',
    'statusReasons',
    'dataState',
    'dataStateReasons',
    'scoreStatus',
    'candidateStatus',
    'executionStatus',
    'executionReasons',
    'researchBoundary',
    'stateContract',
    'claimClassContract',
    'claimClasses',
    'deviationProbabilitySemantics',
    'ckGeometryInterpretation',
    'feeAppliedToReturns',
    'feeModel',
    'targetRecomputedAtEntry',
    'targetTiming',
    'targetContextPolicy',
    'intrabarPolicy',
    'grossReturnPct',
    'netReturnPct',
  ],
  'replay runtime',
)

const compactReplay = withoutWhitespace(replaySource)
assertCompactTokens(
  replaySource,
  [
    "parseMarkets(args.market??'A股')",
    'config.markets.includes(entry.market)',
    "minRows:positiveIntArg(args['min-rows'],360,'min-rows')",
    "requestedFeeRate=finiteArg(args.fee,0.0011,'fee',{min:0,max:1,maxExclusive:true})",
    "targetTiming:'signal-context-frozen-target-recomputed-with-next-session-open'",
    "targetContextPolicy:'cost-band-deviation-half-life-and-drawdown-frozen-at-signal-close'",
    "calculation:mode==='replay'?'netReturn=grossReturn-feeRate-once':'not-applied-in-latest-observation-mode'",
  ],
  'replay runtime semantics',
)
assert.ok(compactReplay.includes('for(leti=260;'), 'replay must retain the 260-row historical start index')
assert.ok(
  compactReplay.includes('entryIndex=signalIndex+1'),
  'replay entry must remain the next session after the signal',
)
assert.ok(
  compactReplay.includes('entryIndex+profile.minSellDays'),
  'replay exit checks must honor minSellDays after entry',
)
assert.ok(
  compactReplay.includes('nextAllowedIndex=i+profileConfig.maxHoldingDays+1'),
  'replay must keep accepted trades non-overlapping per instrument',
)
assert.ok(
  compactReplay.includes('netReturn=grossReturn-config.feeRate'),
  'replay fee must remain a single aggregate return drag',
)
assert.ok(
  compactReplay.includes("intrabarPolicy:'stop-first-conservative-when-both-hit'"),
  'replay must retain the conservative same-bar policy',
)
assert.ok(
  compactReplay.includes("targetTiming:'signal-context-frozen-target-recomputed-with-next-session-open'"),
  'replay must retain next-open target recomputation',
)

assertObjectDefaults(replaySource, 'STRICT_DEFAULTS', {
  targetReturn: '0.03',
  stopLoss: '0.015',
  minZ: '2',
  maxCkGeometryPercentile: '3',
  maxHalfLifeDays: '12',
  minCostSlopePct: '-1',
  maxCostSlopePct: '1',
  minCostDistancePct: '10',
  maxCostDistancePct: '16',
  maxEntryGapPct: '0.5',
  minEntryGapPct: '-3',
  maxHoldingDays: '5',
  minSellDays: '1',
  targetMode: "'structure'",
  anchorRecoveryFraction: '0.875',
})

assertObjectDefaults(replaySource, 'SWING_DEFAULTS', {
  targetReturn: '0.04',
  stopLoss: '0.015',
  minZ: '2.5',
  maxCkGeometryPercentile: '5',
  maxHalfLifeDays: '20',
  minCostSlopePct: '-1',
  maxCostSlopePct: '0.5',
  minCostDistancePct: '12',
  maxCostDistancePct: '22',
  maxEntryGapPct: '0.5',
  minEntryGapPct: '-3',
  maxHoldingDays: '10',
  minSellDays: '1',
  targetMode: "'structure'",
  anchorRecoveryFraction: '0.875',
})

assertCompactTokens(
  screenSource,
  [
    "parseMarkets(args.market??'A股,港股')",
    "top=positiveIntArg(args.top,20,'top')",
    "minRows=positiveIntArg(args['min-rows'],180,'min-rows')",
    "format=enumArg(args.format??'markdown',SUPPORTED_FORMATS,'format')",
  ],
  'screen runtime defaults',
)

assertCliFails(
  '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  ['--top', '0'],
  'expected a positive integer',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs',
  ['--typo', '1'],
  'unknown option --typo',
)
assertCliFails('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', ['--fee', '-0.1'], 'invalid --fee')
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--min-distance', '20', '--max-distance', '10'],
  'invalid distance bounds',
)
assertCliFails(
  '.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs',
  ['--min-sell-days', '6', '--max-hold', '5'],
  'invalid holding bounds',
)

const poolGeneratorSource = read('scripts/generate-recommended-pool.mjs')
assert.doesNotMatch(
  poolGeneratorSource,
  /computeRSI|computeKDJ|\brsi\s*:|\bj\s*:/,
  'recommended-pool generator must not compute or emit RSI/KDJ',
)
const poolDomainSource = read('src/domain/strategy-planning/recommendedStockPool.js')
assertTokens(
  poolDomainSource,
  [
    'FORBIDDEN_SCORE_INPUT_KEYS',
    'allowedDimensionIds',
    'canonicalDimensionsById',
    'duplicate-dimension-id',
    'dimension-id-not-in-library',
    'forbidden-indicator-input',
  ],
  'recommended-pool score boundary',
)

const screenPayload = runCliJson('.agents/skills/china-stock-selection/scripts/screen-cn-stocks.mjs', [
  '--market',
  '港股',
  '--top',
  '1',
  '--format',
  'json',
])
assert.equal(screenPayload.schemaVersion, 'china-stock-selection.screen.v1')
assertStateContract(screenPayload.stateContract, 'screen JSON')
assertClaimClassContract(screenPayload.claimClassContract, 'screen JSON')
assertClaimClasses(screenPayload.claimClasses, 'screen JSON')
assert.ok(screenPayload.ranked.length > 0, 'screen JSON smoke requires at least one ranked candidate')
const screenCandidate = screenPayload.ranked[0]
assertFourStateRow(screenCandidate, 'screen candidate')
assertClaimClasses(screenCandidate.claimClasses, 'screen candidate')
assert.equal(screenCandidate.status, screenCandidate.candidateStatus, 'screen legacy status must alias candidateStatus')
assert.ok(
  Object.hasOwn(screenCandidate.formula.syntheticCkGeometry, 'fullRangeV2IlProxyPct'),
  'screen must name the full-range v2 IL proxy explicitly',
)
assert.ok(
  !Object.hasOwn(screenCandidate.formula.syntheticCkGeometry, 'relativeIlShapePct'),
  'screen must not imply the full-range v2 proxy is v3 range IL',
)

const replayPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode',
  'latest',
  '--market',
  '港股',
  '--format',
  'json',
])
assert.equal(replayPayload.schemaVersion, 'china-stock-selection.replay.v1')
assertStateContract(replayPayload.stateContract, 'replay JSON')
assertClaimClassContract(replayPayload.claimClassContract, 'replay JSON')
assertClaimClasses(replayPayload.claimClasses, 'replay JSON')
for (const row of replayPayload.signals) {
  assertFourStateRow(row, 'replay signal')
  assertClaimClasses(row.claimClasses, 'replay signal')
  assert.equal(row.status, row.candidateStatus, 'replay legacy status must alias candidateStatus')
}

const fixedReplayPayload = runCliJson('.agents/skills/china-stock-selection/scripts/replay-short-hold.mjs', [
  '--mode',
  'replay',
  '--market',
  '港股',
  '--profile',
  'strict',
  '--format',
  'json',
  '--target-mode',
  'fixed',
  '--min-z',
  '0',
  '--ck-geometry-max',
  '100',
  '--max-hl',
  '10000',
  '--min-slope',
  '-100',
  '--max-slope',
  '100',
  '--min-distance',
  '0',
  '--max-distance',
  '100',
  '--max-entry-gap',
  '100',
  '--min-entry-gap',
  '-100',
  '--max-hold',
  '30',
])
assert.ok(fixedReplayPayload.trades.length > 0, 'fixed-target replay smoke must exercise at least one trade')
for (const row of fixedReplayPayload.trades) {
  assertFourStateRow(row, 'fixed replay trade')
  assert.ok(row.dynamicHolding, 'fixed-target replay must retain dynamic-holding gates')
  assert.notEqual(row.dynamicHolding.phase, 'low-compression', 'fixed-target replay must not execute low-compression')
  assert.equal(
    row.dynamicHolding.targetInputMode,
    'fixed-return-replay-assumption-with-structural-gates',
    'fixed target must remain behind structural gates',
  )
}

console.log('china-stock-selection runtime parity: ok')

function read(path) {
  return readFileSync(new URL(path, new URL(`file://${root}/`)), 'utf8')
}

function resolve(path) {
  return fileURLToPath(new URL(path, new URL(`file://${root}/`)))
}

function assertTokens(source, tokens, label) {
  for (const token of tokens) {
    assert.ok(source.includes(token), `${label} must include ${token}`)
  }
}

function assertCompactTokens(source, tokens, label) {
  const compact = withoutWhitespace(source)
  for (const token of tokens) {
    assert.ok(compact.includes(withoutWhitespace(token)), `${label} must include ${token}`)
  }
}

function assertObjectDefaults(source, constantName, expected) {
  const body = objectLiteral(source, constantName)
  const compact = withoutWhitespace(body)
  for (const [key, value] of Object.entries(expected)) {
    assert.ok(compact.includes(`${key}:${withoutWhitespace(value)}`), `${constantName}.${key} must remain ${value}`)
  }
}

function objectLiteral(source, constantName) {
  const marker = `const ${constantName} =`
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1, `${constantName} declaration must exist`)
  const start = source.indexOf('{', markerIndex + marker.length)
  assert.notEqual(start, -1, `${constantName} must be an object literal`)

  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  assert.fail(`${constantName} object literal must be closed`)
}

function withoutWhitespace(source) {
  return source.replace(/\s+/g, '')
}

function syntaxCheck(path) {
  const result = spawnSync(process.execPath, ['--check', path], { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `${path} syntax check failed: ${result.stderr || result.stdout}`)
}

function assertCliFails(path, args, expectedMessage) {
  const result = spawnSync(process.execPath, [path, ...args], { cwd: root, encoding: 'utf8' })
  assert.notEqual(result.status, 0, `${path} ${args.join(' ')} must fail`)
  assert.match(
    `${result.stderr}${result.stdout}`,
    new RegExp(escapeRegExp(expectedMessage)),
    `${path} ${args.join(' ')} must report ${expectedMessage}`,
  )
}

function runCliJson(path, args) {
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  assert.equal(result.status, 0, `${path} JSON smoke failed: ${result.stderr || result.stdout}`)
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    assert.fail(`${path} must emit valid JSON: ${error.message}`)
  }
}

function assertStateContract(contract, label) {
  assert.deepEqual(
    Object.keys(contract),
    ['dataState', 'scoreStatus', 'candidateStatus', 'executionStatus'],
    `${label} must declare four separate states`,
  )
  for (const values of Object.values(contract)) {
    assert.ok(Array.isArray(values) && values.length > 0, `${label} state enum must be non-empty`)
  }
}

function assertFourStateRow(row, label) {
  for (const field of ['dataState', 'scoreStatus', 'candidateStatus', 'executionStatus']) {
    assert.ok(Object.hasOwn(row, field), `${label} must include ${field}`)
  }
  assert.notEqual(row.dataState, row.scoreStatus, `${label} must not conflate data and score state`)
}

function assertClaimClasses(claimClasses, label) {
  assert.ok(claimClasses && typeof claimClasses === 'object', `${label} must include claimClasses`)
  assert.ok(Object.keys(claimClasses).length > 0, `${label} claimClasses must be non-empty`)
  for (const [claim, claimClass] of Object.entries(claimClasses)) {
    assert.ok(CLAIM_CLASS_ENUM.has(claimClass), `${label}.${claim} has invalid claim class ${claimClass}`)
  }
}

function assertClaimClassContract(contract, label) {
  assert.deepEqual(
    contract?.allowedValues,
    [...CLAIM_CLASS_ENUM],
    `${label} must expose the complete five-value claim-class enum`,
  )
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
