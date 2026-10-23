import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalOptionsStore, optionsBundleDigest, OPTIONS_LOCAL_FORMAT } from './localFiles.mjs'

const fixture = () => ({
  schemaVersion: 1,
  kind: 'eth-options-snapshot',
  source: 'deribit',
  collectedAt: '2026-10-23T10:00:00.000Z',
  trades: [],
  provenance: { scope: 'local-research', publicDataOnly: true, licenseScope: 'local-personal-research' },
})

test('private immutable envelope roundtrip checks digest and keeps analysis beside its input', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'market-lab-options-')))
  try {
    const store = createLocalOptionsStore(root)
    const bundle = fixture()
    const path = await store.save(bundle)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    const envelope = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(envelope.format, OPTIONS_LOCAL_FORMAT)
    assert.equal(envelope.sha256, optionsBundleDigest(bundle))
    assert.deepEqual((await store.read(path)).bundle, bundle)
    await assert.rejects(store.save(bundle), (error) => error.code === 'EEXIST')
    const reportPath = await store.saveAnalysis(path, { status: 'observed' })
    assert.equal(reportPath, path.replace(/\.json$/, '.analysis.json'))
    assert.equal((await stat(reportPath)).mode & 0o777, 0o600)
    envelope.bundle.trades.push({ price: 1 })
    await writeFile(path, JSON.stringify(envelope))
    await assert.rejects(store.read(path), /integrity/)
    const outside = join(root, 'outside.json')
    await writeFile(outside, JSON.stringify(envelope))
    await assert.rejects(store.read(outside), /input-must/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('symlinked research ancestor is rejected before creating anything in public', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'market-lab-options-link-')))
  try {
    await mkdir(join(root, 'data'))
    await mkdir(join(root, 'public'))
    await symlink(join(root, 'public'), join(root, 'data', 'local-research'))
    const store = createLocalOptionsStore(root)
    await assert.rejects(store.save(fixture()), /symlinked/)
    await assert.rejects(stat(join(root, 'public', 'eth-options')), (error) => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
