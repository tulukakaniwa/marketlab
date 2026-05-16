#!/usr/bin/env node
// Verify that csv2js generated loadable JS data for the required market samples.

import { loadMarketCsv, marketCsvFiles } from '../src/data/generated/market-csv-index.js'

const REQUIRED_SAMPLE = 'btcusdt-1d-2017-2025.csv'
const errors = []

if (!marketCsvFiles.includes(REQUIRED_SAMPLE)) {
  errors.push(`generated index missing ${REQUIRED_SAMPLE}`)
}

const btc = await loadMarketCsv(`/data/${REQUIRED_SAMPLE}`)
if (!btc) {
  errors.push(`generated loader returned no data for ${REQUIRED_SAMPLE}`)
} else {
  const firstLine = btc.split(/\r?\n/, 1)[0] ?? ''
  if (!/^\d{10,13},/.test(firstLine)) {
    errors.push(`${REQUIRED_SAMPLE} generated content does not look like Binance kline CSV`)
  }
}

console.log(`generated market CSV modules: ${marketCsvFiles.length}`)

if (errors.length) {
  console.error(`\n${errors.length} generated data error(s):`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}

console.log('\ngenerated data integrity OK')
