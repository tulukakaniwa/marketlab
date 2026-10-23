import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBoundedCollection } from './collectors.mjs'

test('whole-lane deadline aborts actual request, preserves upstream signal and prevents save', async () => {
  let expire
  let observedSignal
  let writes = 0
  let timerCleared = false
  const collection = createBoundedCollection({
    timers: {
      setTimeout(fn) {
        expire = fn
        return 1
      },
      clearTimeout() {
        timerCleared = true
      },
    },
    fetchImpl: (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        observedSignal = signal
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
    writeArchive: async () => {
      writes++
    },
  })
  const source = new AbortController()
  const task = collection.run(
    45000,
    async (fetchImpl) => {
      await fetchImpl('https://example.invalid/public', { signal: source.signal })
      return {}
    },
    () => {},
  )
  const rejection = assert.rejects(task, { name: 'TimeoutError' })
  expire()
  await rejection
  assert.equal(observedSignal.aborted, true)
  assert.equal(source.signal.aborted, false)
  assert.equal(writes, 0)
  assert.equal(timerCleared, true)
})

test('cancel remains authoritative if a collector catches an aborted fetch and returns late', async () => {
  let finish
  let writes = 0
  const collection = createBoundedCollection({
    writeArchive: async () => {
      writes++
    },
    timers: {
      setTimeout() {
        return 1
      },
      clearTimeout() {},
    },
  })
  const task = collection.run(
    90000,
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    () => {},
  )
  const rejection = assert.rejects(task, { name: 'AbortError' })
  collection.stop()
  finish({ late: true })
  await rejection
  assert.equal(writes, 0)
})
