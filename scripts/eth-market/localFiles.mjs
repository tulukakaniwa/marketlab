import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MARKET_LOCAL_FORMAT = 'market-lab-eth-market-local-v1'
const MAX_BYTES = 20 * 1024 * 1024
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
export const marketBundleDigest = (bundle) => createHash('sha256').update(JSON.stringify(bundle)).digest('hex')

function assertBundle(bundle) {
  if (
    bundle?.schemaVersion !== 1 ||
    bundle.kind !== 'eth-market-snapshot' ||
    bundle.source !== 'binance' ||
    bundle.symbol !== 'ETHUSDT' ||
    !['5m', '1h'].includes(bundle.interval) ||
    !Array.isArray(bundle.candles) ||
    !bundle.candles.length ||
    bundle.candles.length > 1000 ||
    bundle.provenance?.scope !== 'local-research' ||
    bundle.provenance?.publicDataOnly !== true ||
    bundle.provenance?.licenseScope !== 'local-personal-research' ||
    typeof bundle.collectedAt !== 'string' ||
    !Number.isFinite(Date.parse(bundle.collectedAt))
  )
    throw new Error('invalid-local-market-bundle')
}

export function createLocalMarketStore(root) {
  const repository = resolve(root)
  const directory = resolve(repository, 'data/local-research/eth-market')
  async function ensureDirectory(create = true) {
    if ((await realpath(repository)) !== repository) throw new Error('research-repository-is-symlinked')
    let current = repository
    for (const segment of ['data', 'local-research', 'eth-market']) {
      current = join(current, segment)
      let info
      try {
        info = await lstat(current)
      } catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error
        try {
          await mkdir(current, { mode: 0o700 })
        } catch (error) {
          if (error.code !== 'EEXIST') throw error
        }
        info = await lstat(current)
      }
      if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(current)) !== current) {
        throw new Error('local-market-directory-must-not-be-symlinked')
      }
    }
  }
  return {
    directory,
    async save(bundle) {
      assertBundle(bundle)
      await ensureDirectory()
      const sha256 = marketBundleDigest(bundle)
      const timestamp = new Date(bundle.collectedAt).toISOString().replace(/[^0-9TZ]/g, '')
      const path = join(directory, `${bundle.symbol}-${bundle.interval}-${timestamp}-${sha256.slice(0, 12)}.json`)
      const text = JSON.stringify({ format: MARKET_LOCAL_FORMAT, sha256, bundle }, null, 2) + '\n'
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('local-market-file-exceeds-20MiB')
      await writeFile(path, text, { flag: 'wx', mode: 0o600 })
      return path
    },
    async read(input) {
      await ensureDirectory(false)
      const path = await realpath(resolve(repository, input))
      if (dirname(path) !== directory || !path.endsWith('.json'))
        throw new Error('input-must-be-in-data/local-research/eth-market')
      const info = await stat(path)
      if (!info.isFile() || info.size > MAX_BYTES) throw new Error('local-market-file-invalid-or-over-20MiB')
      const envelope = JSON.parse(await readFile(path, 'utf8'))
      if (
        envelope.format !== MARKET_LOCAL_FORMAT ||
        !/^[0-9a-f]{64}$/.test(envelope.sha256) ||
        marketBundleDigest(envelope.bundle) !== envelope.sha256
      )
        throw new Error('market-bundle-integrity-mismatch')
      assertBundle(envelope.bundle)
      return { path, bundle: envelope.bundle, sha256: envelope.sha256 }
    },
  }
}
const store = createLocalMarketStore(repoRoot)
export const saveMarketBundle = (bundle) => store.save(bundle)
export const readLocalMarketBundle = (input) => store.read(input)
