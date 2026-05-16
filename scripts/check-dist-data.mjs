#!/usr/bin/env node
// Verify that the production bundle contains the static CSV data copied by Vite.
// This runs after `vite build` so a deployment cannot silently publish an app
// whose `/datasets/*.csv` requests fall through to the SPA index.html.

import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const PUBLIC_DATA_DIR = join(ROOT, 'public', 'data')
const DIST_DATA_DIR = join(ROOT, 'dist', 'datasets')
const REQUIRED_SAMPLE = 'btcusdt-1d-2017-2025.csv'

const errors = []

const publicFiles = await listCsvFiles(PUBLIC_DATA_DIR, 'public/data')
const distFiles = await listCsvFiles(DIST_DATA_DIR, 'dist/data')
const publicSet = new Set(publicFiles)
const distSet = new Set(distFiles)

if (!distSet.has(REQUIRED_SAMPLE)) {
  errors.push(`dist/datasets missing required sample: ${REQUIRED_SAMPLE}`)
}

for (const file of publicFiles) {
  if (!distSet.has(file)) errors.push(`dist/datasets missing CSV copied from public/data: ${file}`)
}

for (const file of distFiles) {
  if (!publicSet.has(file)) errors.push(`dist/datasets has unexpected CSV not present in public/data: ${file}`)
}

if (distSet.has(REQUIRED_SAMPLE)) {
  const samplePath = join(DIST_DATA_DIR, REQUIRED_SAMPLE)
  const sampleStat = await stat(samplePath)
  if (sampleStat.size < 1024) errors.push(`${REQUIRED_SAMPLE} is unexpectedly small in dist/datasets (${sampleStat.size} bytes)`)

  const firstBytes = await readFile(samplePath, 'utf8')
  const firstLine = firstBytes.split(/\r?\n/, 1)[0] ?? ''
  if (!/^\d{10,13},/.test(firstLine)) {
    errors.push(`${REQUIRED_SAMPLE} does not look like Binance kline CSV in dist/datasets`)
  }
  if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(firstBytes)) {
    errors.push(`${REQUIRED_SAMPLE} contains an HTML shell instead of CSV`)
  }
}

console.log(`public/data/*.csv: ${publicFiles.length} files`)
console.log(`dist/datasets/*.csv: ${distFiles.length} files`)

if (errors.length) {
  console.error(`\n${errors.length} dist data error(s):`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('\ndist data integrity OK')

async function listCsvFiles(dir, label) {
  try {
    return (await readdir(dir)).filter((file) => file.endsWith('.csv')).sort()
  } catch (error) {
    errors.push(`cannot read ${label}: ${error.message}`)
    return []
  }
}
