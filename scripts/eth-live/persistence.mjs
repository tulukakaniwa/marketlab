import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { validateResearchBundle } from './validation.mjs'

export const LIVE_KINDS = Object.freeze(['market', 'lp', 'options'])
export const MAX_RECORDS_PER_KIND = 288
const MANIFEST_LIMIT = 1024 * 1024
const HASH = /^[a-f0-9]{64}$/
const FORMAT = Object.fromEntries(LIVE_KINDS.map((kind) => [kind, `market-lab-eth-${kind}-local-v1`]))
export const BUNDLE_LIMITS = { market: 20 * 1024 * 1024, options: 20 * 1024 * 1024, lp: 100 * 1024 * 1024 }
const digest = (bundle) => createHash('sha256').update(JSON.stringify(bundle)).digest('hex')
const iso = (value) => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Date.parse(value) > 0
function verifyOrder(previous, next) {
  if (!previous) return
  if (Date.parse(previous.receivedAt) > Date.parse(next.receivedAt)) throw new Error('receipt-clock-moved-backwards')
  if (Date.parse(previous.availableAt) >= Date.parse(next.availableAt))
    throw new Error('source-availability-not-advancing')
  const effective = (item) => Math.max(Date.parse(item.availableAt), Date.parse(item.receivedAt))
  if (effective(previous) >= effective(next)) throw new Error('effective-availability-not-advancing')
}

function retentionFor(records, discarded = {}, maxRecords = MAX_RECORDS_PER_KIND) {
  return {
    maxRecordsPerKind: maxRecords,
    retainedFrom: Object.fromEntries(
      LIVE_KINDS.map((kind) => [kind, records.find((item) => item.kind === kind)?.receivedAt ?? null]),
    ),
    discarded: Object.fromEntries(LIVE_KINDS.map((kind) => [kind, discarded[kind] ?? 0])),
  }
}

async function directory(root, segments, create = false) {
  if ((await realpath(root)) !== root) throw new Error('research-root-symlink')
  let path = root
  for (const segment of segments) {
    path = join(path, segment)
    if (create) {
      try {
        await mkdir(path, { mode: 0o700 })
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
      }
    }
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== path)
      throw new Error('research-directory-symlink')
  }
  return path
}

async function boundedRead(path, limit) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > limit) throw new Error('research-file-size-or-type')
    // Read at most limit + 1 even if another process grows the file after stat.
    const chunks = []
    let bytes = 0
    while (bytes <= limit) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - bytes))
      const { bytesRead } = await file.read(chunk, 0, chunk.length)
      if (!bytesRead) break
      chunks.push(chunk.subarray(0, bytesRead))
      bytes += bytesRead
    }
    if (bytes > limit) throw new Error('research-file-size-or-type')
    return Buffer.concat(chunks).toString('utf8')
  } finally {
    await file.close()
  }
}

export function publicRecord({ id, kind, availableAt, receivedAt, sha256 }) {
  return { id, kind, availableAt, receivedAt, sha256, url: `/bundles/${kind}/${sha256}` }
}

/** Only references are retained/trimmed; immutable original envelopes are never deleted. */
export function createLiveRepository(
  root,
  { now = Date.now, maxRecords = MAX_RECORDS_PER_KIND, validate = validateResearchBundle } = {},
) {
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > MAX_RECORDS_PER_KIND)
    throw new Error('invalid-retention-limit')
  const repository = resolve(root)
  const liveDirectory = join(repository, 'data/local-research/eth-live')
  const manifestPath = join(liveDirectory, 'manifest.json')
  let state = {
    version: 1,
    sessionId: randomUUID(),
    updatedAt: new Date(now()).toISOString(),
    records: [],
    retention: retentionFor([], {}, maxRecords),
  }
  let queue = Promise.resolve()
  let initialized = false

  async function verify(kind, input) {
    if (!LIVE_KINDS.includes(kind)) throw new Error('invalid-research-kind')
    const expected = await directory(repository, ['data', 'local-research', `eth-${kind}`])
    const path = resolve(repository, input)
    if (dirname(path) !== expected || !/^[A-Za-z0-9.-]+\.json$/.test(basename(path)))
      throw new Error('research-path-outside-fixed-directory')
    const text = await boundedRead(path, BUNDLE_LIMITS[kind])
    const envelope = JSON.parse(text)
    if (envelope.format !== FORMAT[kind] || !HASH.test(envelope.sha256) || digest(envelope.bundle) !== envelope.sha256)
      throw new Error('research-envelope-integrity')
    const bundle = envelope.bundle
    const availableAt = validate(kind, bundle)
    const capturedAt = kind === 'lp' ? bundle?.provenance?.fetchedAt : bundle?.collectedAt
    if (!iso(availableAt) || !iso(capturedAt) || Date.parse(availableAt) < Date.parse(capturedAt))
      throw new Error('research-availability-invalid')
    return {
      text,
      record: { id: envelope.sha256, kind, availableAt, sha256: envelope.sha256, path: relative(repository, path) },
    }
  }

  async function persist(next) {
    await directory(repository, ['data', 'local-research', 'eth-live'], true)
    const temporary = join(liveDirectory, `.${randomUUID()}.tmp`)
    const text = JSON.stringify(next, null, 2) + '\n'
    if (Buffer.byteLength(text) > MANIFEST_LIMIT) throw new Error('manifest-too-large')
    try {
      await writeFile(temporary, text, { flag: 'wx', mode: 0o600 })
      await rename(temporary, manifestPath)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }

  return {
    async initialize() {
      if (initialized) return
      await directory(repository, ['data', 'local-research', 'eth-live'], true)
      let restored
      try {
        restored = JSON.parse(await boundedRead(manifestPath, MANIFEST_LIMIT))
      } catch (error) {
        if (error.code !== 'ENOENT') throw new Error('manifest-restore-failed', { cause: error })
      }
      if (restored) {
        if (
          restored.version !== 1 ||
          !/^[a-f0-9-]{36}$/.test(restored.sessionId) ||
          !iso(restored.updatedAt) ||
          !Array.isArray(restored.records) ||
          restored.records.length > MAX_RECORDS_PER_KIND * LIVE_KINDS.length
        )
          throw new Error('manifest-restore-invalid')
        const verified = []
        const ids = new Set()
        const counts = {}
        for (const item of restored.records) {
          const { record } = await verify(item.kind, item.path)
          if (
            item.sha256 !== record.sha256 ||
            item.id !== record.id ||
            item.availableAt !== record.availableAt ||
            !iso(item.receivedAt) ||
            ids.has(record.id)
          )
            throw new Error('manifest-record-integrity')
          const previous = verified.findLast((entry) => entry.kind === record.kind)
          verifyOrder(previous, item)
          if (verified.length && Date.parse(verified.at(-1).receivedAt) > Date.parse(item.receivedAt))
            throw new Error('manifest-global-receipt-order')
          if (Date.parse(item.receivedAt) > Date.parse(restored.updatedAt))
            throw new Error('manifest-update-before-receipt')
          counts[item.kind] = (counts[item.kind] || 0) + 1
          if (counts[item.kind] > MAX_RECORDS_PER_KIND) throw new Error('manifest-source-retention-limit')
          ids.add(record.id)
          verified.push({ ...record, receivedAt: item.receivedAt })
        }
        if (restored.retention !== undefined) {
          const retained = restored.retention
          if (
            !Number.isInteger(retained?.maxRecordsPerKind) ||
            retained.maxRecordsPerKind < 1 ||
            retained.maxRecordsPerKind > MAX_RECORDS_PER_KIND
          )
            throw new Error('manifest-retention-invalid')
          const expected = retentionFor(verified)
          for (const kind of LIVE_KINDS) {
            if (
              !Number.isSafeInteger(retained.discarded?.[kind]) ||
              retained.discarded[kind] < 0 ||
              retained.retainedFrom?.[kind] !== expected.retainedFrom[kind] ||
              (counts[kind] || 0) > retained.maxRecordsPerKind
            )
              throw new Error('manifest-retention-invalid')
          }
        }
        state = {
          ...restored,
          records: verified,
          retention: retentionFor(verified, restored.retention?.discarded, maxRecords),
        }
      } else await persist(state)
      initialized = true
    },
    append(kind, path) {
      const task = queue.then(async () => {
        if (!initialized) throw new Error('manifest-not-initialized')
        const { record } = await verify(kind, path)
        const existing = state.records.find((item) => item.id === record.id)
        if (existing) return publicRecord(existing)
        record.receivedAt = new Date(now()).toISOString()
        if (Date.parse(record.receivedAt) < Date.parse(state.updatedAt))
          throw new Error('receipt-clock-moved-backwards')
        const previous = state.records.findLast((entry) => entry.kind === kind)
        verifyOrder(previous, record)
        const all = [...state.records, record]
        const kept = new Set(
          all
            .filter((item) => item.kind === kind)
            .slice(-maxRecords)
            .map((item) => item.id),
        )
        const records = all.filter((item) => item.kind !== kind || kept.has(item.id))
        const discarded = {
          ...state.retention.discarded,
          [kind]: state.retention.discarded[kind] + all.length - records.length,
        }
        if (!Number.isSafeInteger(discarded[kind])) throw new Error('retention-counter-overflow')
        const next = {
          ...state,
          updatedAt: record.receivedAt,
          records,
          retention: retentionFor(records, discarded, maxRecords),
        }
        await persist(next)
        state = next
        return publicRecord(record)
      })
      queue = task.catch(() => {})
      return task
    },
    snapshot() {
      return { ...state, records: state.records.map(publicRecord), retention: structuredClone(state.retention) }
    },
    async read(kind, hash) {
      const record = state.records.find((item) => item.kind === kind && item.sha256 === hash)
      if (!record) return null
      const verified = await verify(kind, record.path)
      if (verified.record.sha256 !== hash || verified.record.availableAt !== record.availableAt)
        throw new Error('manifest-record-integrity')
      return verified.text
    },
  }
}
