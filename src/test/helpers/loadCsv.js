import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseCsvText } from '../../domain/market-data/ohlcv.js'

export function loadCsv(relativePath) {
  const absPath = resolve(process.cwd(), relativePath)
  const text = readFileSync(absPath, 'utf8')
  return parseCsvText(text)
}
