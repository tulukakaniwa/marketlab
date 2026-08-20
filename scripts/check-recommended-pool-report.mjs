#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RECOMMENDED_POOL_REPORT_SCHEMA } from '../src/domain/strategy-planning/recommendedPoolReport.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = join(ROOT, 'src', 'data', 'recommended-pool-latest.json')
const report = JSON.parse(await readFile(REPORT_PATH, 'utf8'))
const candidates = report.candidatesAll
const recomputedCounts = Object.fromEntries(
  ['观察', '等待', '剔除', '需刷新数据'].map((status) => [
    status,
    candidates.filter((candidate) => candidate.candidateStatus === status).length,
  ]),
)

assert.equal(report.schemaVersion, RECOMMENDED_POOL_REPORT_SCHEMA)
assert.deepEqual(report.markets, ['A股'])
assert.equal(report.canonicalSummary.filters.requireShebaoForAshareOnly, true)
assert.equal(report.canonicalSummary.filters.excludeAlcohol, true)
assert.equal(report.canonicalSummary.filters.excludeBanks, true)
assert.equal(report.canonicalSummary.filters.excludeRealestate, true)
assert.equal(report.canonicalSummary.filters.excludeNortheast, true)
assert.equal(report.totalCandidates, report.canonicalSummary.audit.dataReady)
assert.deepEqual(report.canonicalSummary.statusCounts, recomputedCounts)
assert.equal(report.rankingPolicy.candidateStatusMutable, false)
assert.equal(report.rankingPolicy.executionStatusMutable, false)
assert.ok(candidates.every((candidate) => candidate.market === 'A股'))
assert.ok(candidates.every((candidate) => candidate.executionStatus === 'blocked'))
assert.ok(report.focusItems.every((candidate) => candidate.candidateStatus === '观察'))
assert.ok(report.waitItems.every((candidate) => candidate.candidateStatus === '等待'))
assert.ok(
  candidates.every((candidate) =>
    ['dataState', 'scoreStatus', 'candidateStatus', 'executionStatus'].every((field) => field in candidate),
  ),
)

console.log(
  `recommended pool report contract passed (${report.totalCandidates} candidates, agent=${report.agentReview.status})`,
)
