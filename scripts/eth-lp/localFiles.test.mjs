import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  bundleDigest,
  ensureLocalRoot,
  localRoot,
  readLocalBundle,
  saveAnalysis,
  saveBundle,
  MAX_LOCAL_BUNDLE_BYTES,
} from './localFiles.mjs'

test('local import rejects modified evidence and paths outside the research directory', async () => {
  await ensureLocalRoot()
  const id = randomUUID()
  const input = join(localRoot, `${id}.json`)
  const external = join(tmpdir(), `${id}.json`)
  const link = join(localRoot, `${id}-link.json`)
  const bundle = { seed: { block: { number: 123 } } }
  const envelope = { format: 'market-lab-eth-lp-local-v1', sha256: bundleDigest(bundle), bundle }
  try {
    await writeFile(input, JSON.stringify(envelope))
    assert.equal((await readLocalBundle(input)).bundle.seed.block.number, 123)
    envelope.bundle.seed.block.number = 124
    await writeFile(input, JSON.stringify(envelope))
    await assert.rejects(readLocalBundle(input), /integrity-mismatch/)
    await writeFile(external, JSON.stringify(envelope))
    await symlink(external, link)
    await assert.rejects(readLocalBundle(external), /input-must-be-in/)
    await assert.rejects(readLocalBundle(link), /input-must-be-in/)
  } finally {
    await Promise.all([input, external, link].map((path) => rm(path, { force: true })))
  }
})

test('analysis replacement does not follow an output symlink', async () => {
  await ensureLocalRoot()
  const id = randomUUID()
  const input = join(localRoot, `${id}.json`)
  const output = input.replace('.json', '.analysis.json')
  const external = join(tmpdir(), `${id}.txt`)
  try {
    await writeFile(external, 'untouched')
    await symlink(external, output)
    await saveAnalysis(input, { status: 'blocked' })
    assert.equal(await readFile(external, 'utf8'), 'untouched')
    assert.equal(JSON.parse(await readFile(output, 'utf8')).status, 'blocked')
  } finally {
    await Promise.all([output, external].map((path) => rm(path, { force: true })))
  }
})

test('LP writer enforces a byte limit before writing and cannot exceed the reader limit', async () => {
  const bundle = {
    seed: { block: { number: 123 } },
    checkpoint: { block: { number: 124 } },
    note: randomUUID() + '界'.repeat(100),
  }
  const path = join(localRoot, `123-124-${bundleDigest(bundle).slice(0, 12)}.json`)
  await assert.rejects(saveBundle(bundle, { maxBytes: 300 }), /output-exceeds/)
  await assert.rejects(stat(path), (error) => error.code === 'ENOENT')
  assert.equal(MAX_LOCAL_BUNDLE_BYTES, 100 * 1024 * 1024)
  await assert.rejects(saveBundle(bundle, { maxBytes: MAX_LOCAL_BUNDLE_BYTES + 1 }), /must-not-exceed-100MiB/)
})
