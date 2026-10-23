import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export const OPTIONS_LOCAL_FORMAT = 'market-lab-eth-options-local-v1'
const MAX_BYTES = 20 * 1024 * 1024
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
export const localOptionsRoot = resolve(repoRoot, 'data/local-research/eth-options')
export function optionsBundleDigest(bundle) {
  return createHash('sha256').update(JSON.stringify(bundle)).digest('hex')
}
function assertBundle(bundle) {
  if (
    bundle?.schemaVersion !== 1 ||
    bundle.kind !== 'eth-options-snapshot' ||
    bundle.source !== 'deribit' ||
    bundle.provenance?.scope !== 'local-research' ||
    bundle.provenance?.publicDataOnly !== true ||
    bundle.provenance?.licenseScope !== 'local-personal-research' ||
    typeof bundle.collectedAt !== 'string' ||
    !Number.isFinite(Date.parse(bundle.collectedAt))
  ) {
    throw new Error('invalid-local-options-bundle')
  }
}

// Exposed for filesystem tests; production wrappers always use this repository.
export function createLocalOptionsStore(root) {
  const repository = resolve(root)
  const directory = resolve(repository, 'data/local-research/eth-options')
  async function ensureDirectory(create = true) {
    if ((await realpath(repository)) !== repository) throw new Error('research-repository-is-symlinked')
    let current = repository
    for (const segment of ['data', 'local-research', 'eth-options']) {
      current = join(current, segment)
      let info
      try {
        info = await lstat(current)
      } catch (error) {
        if (error.code !== 'ENOENT' || !create) throw error
        try {
          await mkdir(current, { mode: 0o700 })
        } catch (mkdirError) {
          if (mkdirError.code !== 'EEXIST') throw mkdirError
        }
        info = await lstat(current)
      }
      if (info.isSymbolicLink() || !info.isDirectory() || (await realpath(current)) !== current) {
        throw new Error('local-options-directory-must-not-be-symlinked')
      }
    }
    return directory
  }
  async function verifiedPath(input) {
    await ensureDirectory(false)
    const path = await realpath(resolve(repository, input))
    const rel = relative(directory, path)
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || dirname(path) !== directory || !path.endsWith('.json')) {
      throw new Error('input-must-be-in-data/local-research/eth-options')
    }
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('local-options-file-invalid-or-over-20MiB')
    return path
  }
  return {
    directory,
    async save(bundle) {
      assertBundle(bundle)
      await ensureDirectory()
      const sha256 = optionsBundleDigest(bundle)
      const timestamp = new Date(bundle.collectedAt).toISOString().replace(/[^0-9TZ]/g, '')
      const path = join(directory, `${timestamp}-${sha256.slice(0, 12)}.json`)
      const text = JSON.stringify({ format: OPTIONS_LOCAL_FORMAT, sha256, bundle }, null, 2) + '\n'
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('local-options-file-exceeds-20MiB')
      await writeFile(path, text, { flag: 'wx', mode: 0o600 })
      return path
    },
    async read(input) {
      const path = await verifiedPath(input)
      const envelope = JSON.parse(await readFile(path, 'utf8'))
      if (
        envelope.format !== OPTIONS_LOCAL_FORMAT ||
        !/^[0-9a-f]{64}$/.test(envelope.sha256) ||
        optionsBundleDigest(envelope.bundle) !== envelope.sha256
      )
        throw new Error('options-bundle-integrity-mismatch')
      assertBundle(envelope.bundle)
      return { path, bundle: envelope.bundle, sha256: envelope.sha256 }
    },
    async saveAnalysis(input, report) {
      const inputPath = await verifiedPath(input)
      const path = inputPath.replace(/\.json$/, '.analysis.json')
      const temporary = join(directory, `.${randomUUID()}.analysis.tmp`)
      const text = JSON.stringify(report, null, 2) + '\n'
      if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('local-options-report-exceeds-20MiB')
      await writeFile(temporary, text, { flag: 'wx', mode: 0o600 })
      await rename(temporary, path)
      return path
    },
  }
}
const store = createLocalOptionsStore(repoRoot)
export const saveOptionsBundle = (bundle) => store.save(bundle)
export const readLocalOptionsBundle = (input) => store.read(input)
export const saveOptionsAnalysis = (input, report) => store.saveAnalysis(input, report)
