#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

import {
  buildRecommendedPoolReport,
  createRecommendedPoolEvidence,
  diagnosticsFromCanonicalCandidate,
} from '../src/domain/strategy-planning/recommendedPoolReport.js'

const executeFile = promisify(execFile)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCREEN_RUNTIME = join(ROOT, '.agents', 'skills', 'china-stock-selection', 'scripts', 'screen-cn-stocks.mjs')
const LATEST_RUNTIME = join(ROOT, '.agents', 'skills', 'china-stock-selection', 'scripts', 'replay-short-hold.mjs')
const OUT_DIR = join(ROOT, 'src', 'data', 'recommended-pools')
const LATEST_PATH = join(ROOT, 'src', 'data', 'recommended-pool-latest.json')
const AGENT_REVIEW_PATH = join(ROOT, 'src', 'data', 'recommended-pool-agent-review.json')

const TOP_N = positiveNumberArg('--top', 10)
const SCREEN_ARGS = Object.freeze([
  '--market',
  'A股',
  '--top',
  '1000',
  '--format',
  'json',
  '--require-shebao',
  'true',
  '--exclude-alcohol',
  'true',
  '--exclude-banks',
  'true',
  '--exclude-realestate',
  'true',
  '--exclude-northeast',
  'true',
])
const LATEST_ARGS = Object.freeze([
  '--profile',
  'combo',
  '--mode',
  'latest',
  '--market',
  'A股',
  '--fee',
  '0.0011',
  '--require-shebao',
  'true',
  '--format',
  'json',
])

await main()

async function main() {
  const [screen, latest, agentReview] = await Promise.all([
    runJsonRuntime(SCREEN_RUNTIME, SCREEN_ARGS),
    runJsonRuntime(LATEST_RUNTIME, LATEST_ARGS),
    readOptionalJson(AGENT_REVIEW_PATH),
  ])
  const diagnosticsBySymbol = Object.fromEntries(
    screen.ranked.map((candidate) => [candidate.symbol, diagnosticsFromCanonicalCandidate(candidate)]),
  )
  const evidence = createRecommendedPoolEvidence({ screen, latest, diagnosticsBySymbol })
  const evidenceDigest = createHash('sha256').update(JSON.stringify(evidence)).digest('hex')
  const generatedAt = new Date().toISOString()
  const report = buildRecommendedPoolReport({
    screen,
    latest,
    diagnosticsBySymbol,
    evidenceDigest,
    agentReview,
    generatedAt,
    topN: TOP_N,
  })

  await mkdir(OUT_DIR, { recursive: true })
  const datedPath = join(OUT_DIR, `stock-pool-${report.generatedDate}.json`)
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  await Promise.all([writeFile(datedPath, serialized, 'utf8'), writeFile(LATEST_PATH, serialized, 'utf8')])

  const counts = report.canonicalSummary.statusCounts
  console.log(
    `研究报告证据生成完毕：A股 ${report.canonicalSummary.audit.considered}→${report.totalCandidates}，观察=${counts.观察}，等待=${counts.等待}，剔除=${counts.剔除}，latest=${report.canonicalSummary.latestSignalCount}，agent=${report.agentReview.status}，dated=${datedPath}`,
  )
}

async function runJsonRuntime(runtime, args) {
  const { stdout } = await executeFile(process.execPath, [runtime, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return JSON.parse(stdout)
}

async function readOptionalJson(path) {
  const parsed = await readFile(path, 'utf8').then(JSON.parse).catch(optionalFileFallback)
  return parsed
}

function optionalFileFallback(error) {
  if (error?.code === 'ENOENT') return null
  console.warn(`Agent 复核文件不可用：${error.message}`)
  return null
}

function positiveNumberArg(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index < 0) return fallback
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}
