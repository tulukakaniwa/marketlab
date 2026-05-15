import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LINES = 500
const ROOTS = ['src']
const EXTENSIONS = new Set(['.js', '.vue', '.css'])

const offenders = []

for (const root of ROOTS) scan(root)

if (offenders.length) {
  console.error(`Files must stay at or below ${MAX_LINES} lines:`)
  for (const file of offenders) console.error(`- ${file.path}: ${file.lines}`)
  process.exit(1)
}

console.log(`file size check passed (${MAX_LINES} lines max)`)

function scan(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      scan(path)
      continue
    }
    if (!EXTENSIONS.has(extensionOf(path))) continue
    const lines = readFileSync(path, 'utf8').split('\n').length
    if (lines > MAX_LINES) offenders.push({ path, lines })
  }
}

function extensionOf(path) {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? path.slice(dot) : ''
}
