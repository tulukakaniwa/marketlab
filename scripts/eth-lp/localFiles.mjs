import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const localRoot = fileURLToPath(new URL('../../data/local-research/eth-lp/', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const format = 'market-lab-eth-lp-local-v1'
export const MAX_LOCAL_BUNDLE_BYTES = 100 * 1024 * 1024

export function bundleDigest(bundle) {
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex')
}

export async function ensureLocalRoot() {
  await mkdir(localRoot, { recursive: true })
  // A local symlink must not redirect research output into a public build directory.
  if ((await realpath(localRoot)) !== resolve(localRoot)) throw new Error('local-research-root-is-symlinked')
  return localRoot
}

export async function saveBundle(bundle, { maxBytes = MAX_LOCAL_BUNDLE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_LOCAL_BUNDLE_BYTES) {
    throw new Error('local-bundle-limit-must-not-exceed-100MiB')
  }
  const hash = bundleDigest(bundle)
  const text = JSON.stringify({ format, sha256: hash, bundle }, null, 2) + '\n'
  if (Buffer.byteLength(text) > maxBytes) throw new Error('output-exceeds-local-bundle-byte-limit')
  await ensureLocalRoot()
  const name = `${bundle.seed.block.number}-${bundle.checkpoint.block.number}-${hash.slice(0, 12)}.json`
  const path = join(localRoot, name)
  await writeFile(path, text, { flag: 'wx', mode: 0o600 })
  return path
}

export async function readLocalBundle(input) {
  await ensureLocalRoot()
  const path = await realpath(resolve(repoRoot, input))
  const rel = relative(localRoot, path)
  if (rel.startsWith(`..${sep}`) || rel === '..' || resolve(localRoot, rel) !== path) {
    throw new Error('input-must-be-in-data/local-research/eth-lp')
  }
  if ((await stat(path)).size > MAX_LOCAL_BUNDLE_BYTES) throw new Error('input-exceeds-100MiB')
  const envelope = JSON.parse(await readFile(path, 'utf8'))
  if (envelope.format !== format || bundleDigest(envelope.bundle) !== envelope.sha256) {
    throw new Error('bundle-integrity-mismatch')
  }
  return { path, bundle: envelope.bundle, sha256: envelope.sha256 }
}

export async function saveAnalysis(inputPath, report, kind = 'analysis') {
  if (!['analysis', 'quoter-check'].includes(kind)) throw new Error('unsupported-report-kind')
  if (dirname(inputPath) !== resolve(localRoot)) throw new Error('analysis-output-must-be-local')
  const path = inputPath.replace(/\.json$/, `.${kind}.json`)
  if (path === inputPath) throw new Error('input-must-be-json')
  const temporary = join(localRoot, `.${randomUUID()}.analysis.tmp`)
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  await rename(temporary, path)
  return path
}

export function parseArgs(argv, allowed) {
  const result = {}
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--help') {
      result.help = true
      continue
    }
    if (!allowed.includes(name) || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`invalid-argument: ${name}`)
    }
    if (result[name] !== undefined) throw new Error(`duplicate-argument: ${name}`)
    result[name] = argv[++index]
  }
  return result
}
