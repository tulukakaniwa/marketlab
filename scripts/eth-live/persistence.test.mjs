import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLiveRepository } from './persistence.mjs'
import { createArchiveWriter } from './archiveBudget.mjs'

const capture = '2026-10-23T12:00:00.000Z'
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function setup(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'eth-live-test-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  async function envelope(kind, sequence) {
    const availableAt = new Date(Date.parse(capture) + sequence * 1000).toISOString()
    const bundle = { availableAt, collectedAt: availableAt, sequence }
    const sha256 = digest(bundle)
    const path = join(root, `data/local-research/eth-${kind}/${sequence}.json`)
    await mkdir(join(root, `data/local-research/eth-${kind}`), { recursive: true })
    await writeFile(path, JSON.stringify({ format: `market-lab-eth-${kind}-local-v1`, sha256, bundle }))
    return { path, sha256 }
  }
  return { root, envelope }
}
const validate = (_kind, bundle) => bundle.availableAt

test('manifest serializes concurrent sources, preserves first receipt and restores verified history', async (t) => {
  const { root, envelope } = await setup(t)
  let now = Date.parse(capture) + 10000
  const repository = createLiveRepository(root, { validate, now: () => now })
  await repository.initialize()
  const files = await Promise.all(['market', 'options', 'lp'].map((kind, i) => envelope(kind, i)))
  // LP capturedAt follows its own source schema, including in this structural fixture.
  const lp = JSON.parse(await readFile(files[2].path, 'utf8'))
  lp.bundle.provenance = { fetchedAt: capture }
  lp.sha256 = digest(lp.bundle)
  await writeFile(files[2].path, JSON.stringify(lp))
  const records = await Promise.all(
    ['market', 'options', 'lp'].map((kind, i) => repository.append(kind, files[i].path)),
  )
  assert.equal(repository.snapshot().records.length, 3)
  assert.equal(records[0].receivedAt, new Date(now).toISOString())
  now += 5000
  assert.deepEqual(await repository.append('market', files[0].path), records[0])
  assert.equal('path' in records[0], false)
  const restored = createLiveRepository(root, { validate })
  await restored.initialize()
  assert.deepEqual(restored.snapshot(), repository.snapshot())
  assert.equal(JSON.parse(await restored.read('market', files[0].sha256)).sha256, files[0].sha256)
})

test('retention drops only oldest references, preserves archives and rejects backward receipt clocks', async (t) => {
  const { root, envelope } = await setup(t)
  let now = Date.parse(capture) + 10000
  const repository = createLiveRepository(root, { validate, now: () => now, maxRecords: 2 })
  await repository.initialize()
  const files = []
  for (let i = 0; i < 3; i++) {
    files.push(await envelope('market', i))
    now++
    await repository.append('market', files[i].path)
  }
  assert.equal(repository.snapshot().records.length, 2)
  assert.equal(repository.snapshot().retention.maxRecordsPerKind, 2)
  assert.equal(repository.snapshot().retention.discarded.market, 1)
  assert.equal(repository.snapshot().retention.retainedFrom.market, repository.snapshot().records[0].receivedAt)
  const restored = createLiveRepository(root, { validate, now: () => now, maxRecords: 2 })
  await restored.initialize()
  assert.deepEqual(restored.snapshot().retention, repository.snapshot().retention)
  now++
  await restored.append('market', (await envelope('market', 3)).path)
  assert.equal(restored.snapshot().retention.discarded.market, 2)
  assert.equal(await repository.read('market', files[0].sha256), null)
  assert.ok(await readFile(files[0].path))
  now -= 1000
  await assert.rejects(repository.append('market', (await envelope('market', 4)).path), /clock-moved-backwards/)
})

test('cross-lane receipt clock rollback is rejected and legacy manifests gain compatible retention metadata', async (t) => {
  const { root, envelope } = await setup(t)
  let now = Date.parse(capture) + 10000
  const repository = createLiveRepository(root, { validate, now: () => now })
  await repository.initialize()
  await repository.append('market', (await envelope('market', 1)).path)
  now--
  await assert.rejects(repository.append('options', (await envelope('options', 2)).path), /clock-moved-backwards/)
  assert.equal(repository.snapshot().records.length, 1)
  const path = join(root, 'data/local-research/eth-live/manifest.json')
  const legacy = JSON.parse(await readFile(path, 'utf8'))
  delete legacy.retention
  await writeFile(path, JSON.stringify(legacy))
  const restored = createLiveRepository(root, { validate })
  await restored.initialize()
  assert.deepEqual(restored.snapshot().retention, {
    maxRecordsPerKind: 288,
    retainedFrom: { market: repository.snapshot().records[0].receivedAt, lp: null, options: null },
    discarded: { market: 0, lp: 0, options: 0 },
  })
})

test('SHA tampering, symlink paths and domain-rejected bundles never enter a manifest', async (t) => {
  const { root, envelope } = await setup(t)
  const repository = createLiveRepository(root, { validate })
  await repository.initialize()
  const good = await envelope('market', 1)
  await repository.append('market', good.path)
  const text = await readFile(good.path, 'utf8')
  await writeFile(good.path, text.replace('"sequence":1', '"sequence":2'))
  await assert.rejects(repository.read('market', good.sha256), /integrity/)
  await assert.rejects(createLiveRepository(root, { validate }).initialize(), /integrity/)
  await writeFile(good.path, text)
  const linked = join(root, 'data/local-research/eth-market/linked.json')
  await symlink(good.path, linked)
  await assert.rejects(repository.append('market', linked))
  const outside = join(root, 'outside.json')
  await writeFile(outside, text)
  await assert.rejects(repository.append('market', outside), /fixed-directory/)
  // Production uses real domain validation, which must reject this structural-only fixture.
  await assert.rejects(createLiveRepository(root).initialize(), /domain-validation/)
  assert.equal(repository.snapshot().records.length, 1)
})

test('source rollback and simultaneous effective availability cannot rewrite retained history', async (t) => {
  const { root, envelope } = await setup(t)
  let now = Date.parse(capture) + 10000
  const repository = createLiveRepository(root, { validate, now: () => now })
  await repository.initialize()
  await repository.append('market', (await envelope('market', 2)).path)
  now++
  await assert.rejects(repository.append('market', (await envelope('market', 1)).path), /source-availability/)
  now--
  await assert.rejects(repository.append('market', (await envelope('market', 3)).path), /effective-availability/)
  assert.equal(repository.snapshot().records.length, 1)
})

test('archive quota serializes reservations and keeps existing files unchanged', async (t) => {
  const { root, envelope } = await setup(t)
  const original = await envelope('market', 1)
  const text = await readFile(original.path, 'utf8')
  const write = createArchiveWriter(root, { limit: Buffer.byteLength(text) + 1 })
  let saves = 0
  await assert.rejects(
    write({ data: 'x' }, async () => {
      saves++
    }),
    { code: 'ARCHIVE_QUOTA' },
  )
  assert.equal(saves, 0)
  assert.equal(await readFile(original.path, 'utf8'), text)
  await unlink(original.path)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    write(
      {},
      async () => {
        saves++
      },
      controller.signal,
    ),
    { name: 'AbortError' },
  )
  assert.equal(saves, 0)
})
