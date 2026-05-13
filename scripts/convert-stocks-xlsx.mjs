import XLSX from 'xlsx'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const INPUT = process.argv[2] || '/Users/wangxuanzhe/Pictures/stocks_20260513.xlsx'
const OUT_DIR = join(import.meta.dirname, '..', 'public', 'data')

const wb = XLSX.readFile(INPUT)
console.log('Sheets:', wb.SheetNames)

// Read all sheets
const sheets = {}
for (const name of ['close', 'high', 'low', 'volume']) {
  const ws = wb.Sheets[name]
  if (!ws) { console.error(`Sheet "${name}" not found`); process.exit(1) }
  sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
}

const closeData = sheets.close
const highData = sheets.high
const lowData = sheets.low
const volumeData = sheets.volume

// Row 0: codes, Row 1: names
const codes = closeData[0].slice(1)
const names = closeData[1].slice(1)

console.log(`Total stocks: ${codes.length}`)
console.log(`Date rows: ${closeData.length - 2}`) // Row 2 is "Date" header, Row 3+ are data

// Build per-stock CSVs
mkdirSync(OUT_DIR, { recursive: true })

let exported = 0
for (let colIdx = 0; colIdx < codes.length; colIdx++) {
  const code = String(codes[colIdx]).trim()
  const name = String(names[colIdx]).trim()
  if (!code || code === 'null') continue

  const rows = []
  for (let rowIdx = 2; rowIdx < closeData.length; rowIdx++) {
    const date = closeData[rowIdx][0]
    if (!date) continue

    const close = numberVal(closeData[rowIdx]?.[colIdx + 1])
    const high = numberVal(highData[rowIdx]?.[colIdx + 1])
    const low = numberVal(lowData[rowIdx]?.[colIdx + 1])
    const volume = numberVal(volumeData[rowIdx]?.[colIdx + 1])

    // Validation: need valid OHLCV
    if (!Number.isFinite(close) || close <= 0) continue
    if (!Number.isFinite(high) || high <= 0) continue
    if (!Number.isFinite(low) || low <= 0) continue
    if (!Number.isFinite(volume) || volume < 0) continue

    // Open = Close for safety (passes high >= max(open,close) and low <= min(open,close))
    const open = close

    rows.push({ date: String(date).trim(), open, high, low, close, volume })
  }

  if (rows.length < 10) {
    console.log(`  SKIP ${code} (${name}): only ${rows.length} valid rows`)
    continue
  }

  // Sort by date ascending
  rows.sort((a, b) => a.date.localeCompare(b.date))

  const csv = ['Date,Open,High,Low,Close,Volume']
  for (const r of rows) {
    csv.push(`${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`)
  }

  const safeName = code.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_')
  const filename = `${safeName}-1d.csv`
  writeFileSync(join(OUT_DIR, filename), csv.join('\n'), 'utf-8')
  console.log(`  OK ${code} (${name}): ${rows.length} rows -> ${filename}`)
  exported++
}

console.log(`\nExported ${exported} stock CSVs to ${OUT_DIR}`)

function numberVal(v) {
  if (v === null || v === undefined || v === '') return NaN
  return Number(String(v).replace(/,/g, ''))
}
