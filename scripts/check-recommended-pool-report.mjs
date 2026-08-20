#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { RECOMMENDED_POOL_REPORT_SCHEMA } from '../src/domain/strategy-planning/recommendedPoolReport.js'
import {
  RECOMMENDED_POOL_QUERY_FUNCTION,
  RECOMMENDED_POOL_QUERY_SCHEMA,
  runRecommendedPoolQuery,
} from '../src/domain/strategy-planning/recommendedPoolQuery.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_PATH = join(ROOT, 'src', 'data', 'recommended-pool-latest.json')
const PAGE_PATH = join(ROOT, 'public', 'recommended-pool', 'index.html')
const [reportSource, page] = await Promise.all([readFile(REPORT_PATH, 'utf8'), readFile(PAGE_PATH, 'utf8')])
const report = JSON.parse(reportSource)
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
assert.equal(report.queryPolicy.schemaVersion, RECOMMENDED_POOL_QUERY_SCHEMA)
assert.equal(report.queryPolicy.functionId, RECOMMENDED_POOL_QUERY_FUNCTION)
assert.deepEqual(report.queryPolicy.immutableFields, ['dataState', 'scoreStatus', 'candidateStatus', 'executionStatus'])
assert.ok(candidates.every((candidate) => candidate.market === 'A股'))
assert.ok(candidates.every((candidate) => candidate.executionStatus === 'blocked'))
assert.ok(report.focusItems.every((candidate) => candidate.candidateStatus === '观察'))
assert.ok(report.waitItems.every((candidate) => candidate.candidateStatus === '等待'))
assert.match(page, /<details class="config" id="config-panel" open>/)
assert.match(page, /id="query-results"/)
assert.match(page, /data-query-threshold="priorityReviewMin"/)
assert.match(page, /data-query-threshold="secondaryReviewMin"/)
assert.match(page, /id="copy-agent-task"/)
assert.ok(page.indexOf('id="config-panel"') < page.indexOf('id="agent-review"'))
assert.ok(report.rankingPolicy.dimensions.every((dimension) => page.includes(`data-dimension-row="${dimension.id}"`)))
assert.ok(report.rankingPolicy.dimensions.filter((dimension) => dimension.queryMutable).length > 0)
assert.ok(
  report.rankingPolicy.dimensions
    .filter((dimension) => dimension.queryMutable)
    .every((dimension) => page.includes(`${dimension.label}权重数值`)),
)
assert.ok(
  report.rankingPolicy.dimensions
    .filter((dimension) => dimension.rangeCondition)
    .every((dimension) => dimension.queryMutable === false),
)
assert.ok(
  candidates.every((candidate) =>
    ['dataState', 'scoreStatus', 'candidateStatus', 'executionStatus'].every((field) => field in candidate),
  ),
)
assert.ok(
  candidates.every((candidate) =>
    report.rankingPolicy.dimensions.every((dimension) => candidate.diagnosticReadings?.[dimension.id]?.availability),
  ),
)
const query = runRecommendedPoolQuery(
  candidates,
  {
    dimensions: report.rankingPolicy.dimensions,
    thresholds: report.queryPolicy.defaultThresholds,
    displayLimit: report.topN,
  },
  report.rankingPolicy.dimensions,
)
assert.equal(
  Object.values(query.counts).reduce((sum, count) => sum + count, 0),
  candidates.length,
)
assert.ok(
  query.groups['canonical-gate'].every(({ candidate }) => ['剔除', '需刷新数据'].includes(candidate.candidateStatus)),
)
assert.ok(query.rows.every(({ candidate }) => candidate.executionStatus === 'blocked'))

console.log(
  `recommended pool report contract passed (${report.totalCandidates} candidates, agent=${report.agentReview.status})`,
)
