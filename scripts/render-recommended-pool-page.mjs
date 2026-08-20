#!/usr/bin/env node

import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderLegacyArchiveNotice, renderRecommendedPoolPage } from './recommended-pool/report-page-template.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC_JSON = join(ROOT, 'src', 'data', 'recommended-pool-latest.json')
const PUBLIC_DIR = join(ROOT, 'public', 'recommended-pool')
const CLIENT_SOURCE = join(ROOT, 'scripts', 'recommended-pool', 'report-client.js')
const STYLE_SOURCE = join(ROOT, 'scripts', 'recommended-pool', 'report-page.css')
const RANKING_SOURCE = join(ROOT, 'src', 'domain', 'strategy-planning', 'recommendedPoolRanking.js')

const report = JSON.parse(await readFile(SRC_JSON, 'utf8'))
const html = renderRecommendedPoolPage(report)
const publicFiles = {
  'index.html': html,
  'data.json': `${JSON.stringify(report, null, 2)}\n`,
}

await mkdir(PUBLIC_DIR, { recursive: true })
await Promise.all([
  ...Object.entries(publicFiles).map(([name, contents]) => writeFile(join(PUBLIC_DIR, name), contents, 'utf8')),
  copyFile(CLIENT_SOURCE, join(PUBLIC_DIR, 'report-client.js')),
  copyFile(STYLE_SOURCE, join(PUBLIC_DIR, 'report-page.css')),
  copyFile(RANKING_SOURCE, join(PUBLIC_DIR, 'report-ranking.js')),
])

const datedDir = join(PUBLIC_DIR, report.generatedDate)
await mkdir(datedDir, { recursive: true })
await Promise.all([
  ...Object.entries(publicFiles).map(([name, contents]) => writeFile(join(datedDir, name), contents, 'utf8')),
  copyFile(CLIENT_SOURCE, join(datedDir, 'report-client.js')),
  copyFile(STYLE_SOURCE, join(datedDir, 'report-page.css')),
  copyFile(RANKING_SOURCE, join(datedDir, 'report-ranking.js')),
])

const quarantinedArchives = await quarantineLegacyPublicSnapshots(report.generatedDate)
const counts = report.canonicalSummary.statusCounts
console.log(
  `生成静态研究报告：${join(PUBLIC_DIR, 'index.html')}（观察=${counts.观察} / 等待=${counts.等待} / 剔除=${counts.剔除} / Agent=${report.agentReview.status} / legacy=${quarantinedArchives}）`,
)

async function quarantineLegacyPublicSnapshots(currentDate) {
  const entries = await readdir(PUBLIC_DIR, { withFileTypes: true })
  const legacyDates = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name) && entry.name !== currentDate)
    .map((entry) => entry.name)

  await Promise.all(
    legacyDates.map(async (date) => {
      const directory = join(PUBLIC_DIR, date)
      const contract = {
        status: 'legacy-contract',
        generatedDate: date,
        executable: false,
        message: '该公开快照使用旧版报告合同，已隔离；请使用当前入口。',
      }
      await Promise.all([
        writeFile(join(directory, 'data.json'), `${JSON.stringify(contract, null, 2)}\n`, 'utf8'),
        writeFile(join(directory, 'index.html'), renderLegacyArchiveNotice(contract), 'utf8'),
      ])
    }),
  )

  return legacyDates.length
}
