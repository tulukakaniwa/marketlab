import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, realpath, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalMarketStore, marketBundleDigest, MARKET_LOCAL_FORMAT } from './localFiles.mjs'

const fixture = () => ({
  schemaVersion: 1,
  kind: 'eth-market-snapshot',
  source: 'binance',
  symbol: 'ETHUSDT',
  interval: '5m',
  collectedAt: '2026-10-23T15:00:00.000Z',
  candles: [{ openTime: 1, closeTime: 2 }],
  provenance: { scope: 'local-research', publicDataOnly: true, licenseScope: 'local-personal-research' },
})

test('market envelope remains immutable, local and digest checked', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'market-lab-market-')))
  try {
    const store = createLocalMarketStore(root)
    const bundle = fixture()
    const path = await store.save(bundle)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
    const envelope = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(envelope.format, MARKET_LOCAL_FORMAT)
    assert.equal(envelope.sha256, marketBundleDigest(bundle))
    assert.deepEqual((await store.read(path)).bundle, bundle)
    await assert.rejects(store.save(bundle), (error) => error.code === 'EEXIST')
    envelope.bundle.candles[0].openTime = 10
    await writeFile(path, JSON.stringify(envelope))
    await assert.rejects(store.read(path), /integrity/)
    const outside = join(root, 'outside.json')
    await writeFile(outside, JSON.stringify(envelope))
    await assert.rejects(store.read(outside), /input-must/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('symlinked research ancestor cannot publish raw market data', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'market-lab-market-link-')))
  try {
    await mkdir(join(root, 'data'))
    await mkdir(join(root, 'public'))
    await symlink(join(root, 'public'), join(root, 'data', 'local-research'))
    await assert.rejects(createLocalMarketStore(root).save(fixture()), /symlinked/)
    await assert.rejects(stat(join(root, 'public', 'eth-market')), (error) => error.code === 'ENOENT')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
