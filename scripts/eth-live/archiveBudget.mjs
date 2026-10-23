import { lstat, readdir, realpath } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LIVE_KINDS } from './persistence.mjs'

export const ARCHIVE_BUDGET_BYTES = 2 * 1024 * 1024 * 1024

/** Serialized quota check across the three immutable local archives. No eviction. */
export function createArchiveWriter(root, { limit = ARCHIVE_BUDGET_BYTES } = {}) {
  const repository = resolve(root)
  let queue = Promise.resolve()
  async function archiveBytes() {
    if ((await realpath(repository)) !== repository) throw new Error('archive-directory-symlink')
    let total = 0
    let entries = 0
    for (const kind of LIVE_KINDS) {
      let path = repository
      let missing = false
      for (const segment of ['data', 'local-research', `eth-${kind}`]) {
        path = join(path, segment)
        let info
        try {
          info = await lstat(path)
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          missing = true
          break
        }
        if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== path)
          throw new Error('archive-directory-symlink')
      }
      if (missing) continue
      for (const name of await readdir(path)) {
        if (++entries > 100000) throw Object.assign(new Error('archive-entry-limit'), { code: 'ARCHIVE_QUOTA' })
        const info = await lstat(join(path, name))
        if (info.isSymbolicLink()) throw new Error('archive-file-symlink')
        if (info.isFile()) total += info.size
      }
    }
    return total
  }
  return (bundle, save, signal) => {
    const task = queue.then(async () => {
      signal?.throwIfAborted()
      // The longest format name bounds the exact pretty-printed envelope size for all three sources.
      const bytes =
        Buffer.byteLength(
          JSON.stringify({ format: 'market-lab-eth-options-local-v1', sha256: '0'.repeat(64), bundle }, null, 2),
        ) + 1
      if ((await archiveBytes()) + bytes > limit)
        throw Object.assign(new Error('local-archive-quota'), { code: 'ARCHIVE_QUOTA' })
      signal?.throwIfAborted()
      return save(bundle)
    })
    queue = task.catch(() => {})
    return task
  }
}
