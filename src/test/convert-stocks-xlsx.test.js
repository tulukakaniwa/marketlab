import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { parseCsvText } from '../domain/market-data/ohlcv.js'

const execFileAsync = promisify(execFile)
const PROJECT_ROOT = process.cwd()
const SCRIPT_PATH = join(PROJECT_ROOT, 'scripts', 'convert-stocks-xlsx.mjs')
const WORKBOOK_PATH = join(PROJECT_ROOT, 'data', 'workbooks', 'smoke.xlsx')
const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('convert-stocks-xlsx', () => {
  it('preserves the workbook opening price instead of replacing it with close', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'market-lab-xlsx-'))
    temporaryDirectories.push(outputRoot)
    const outputDirectory = join(outputRoot, 'data')
    const indexPath = join(outputRoot, 'stock-index.json')

    await execFileAsync(process.execPath, [
      SCRIPT_PATH,
      WORKBOOK_PATH,
      '--out-dir',
      outputDirectory,
      '--index-path',
      indexPath,
      '--replace-index',
    ])

    const rows = parseCsvText(await readFile(join(outputDirectory, '000568-1d.csv'), 'utf8'))
    expect(rows[0]).toMatchObject({
      date: '2025-07-16',
      open: 113.2037,
      close: 115.1016,
    })
    expect(rows.some((row) => row.open !== row.close)).toBe(true)
    const index = JSON.parse(await readFile(indexPath, 'utf8'))
    expect(index[0]).toMatchObject({
      priceBasis: 'adjusted',
      dataThrough: '2026-05-15',
      isPartial: false,
      isStale: false,
    })
  })
})
