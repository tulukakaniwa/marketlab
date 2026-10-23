import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLiveScheduler } from './scheduler.mjs'

const settle = () => new Promise((resolve) => setImmediate(resolve))
function clock() {
  const tasks = new Map()
  let id = 0
  return {
    tasks,
    setTimeout(fn, delay) {
      const key = ++id
      tasks.set(key, { fn, delay })
      return key
    },
    clearTimeout(key) {
      tasks.delete(key)
    },
  }
}

test('three independent lanes never overlap and repeat only after settlement', async () => {
  const timers = clock()
  const resolve = {}
  const calls = { market: 0, lp: 0, options: 0 }
  const collectors = Object.fromEntries(
    Object.keys(calls).map((kind) => [
      kind,
      () => {
        calls[kind]++
        return new Promise((done) => {
          resolve[kind] = done
        })
      },
    ]),
  )
  const appended = []
  const scheduler = createLiveScheduler({
    collectors,
    timers,
    repository: { append: async (...args) => appended.push(args) },
  })
  const first = scheduler.start()
  await settle()
  assert.deepEqual(calls, { market: 1, lp: 1, options: 1 })
  assert.equal(timers.tasks.size, 0)
  await scheduler.start()
  resolve.market('market-path')
  await settle()
  assert.equal(timers.tasks.size, 1)
  assert.equal([...timers.tasks.values()][0].delay, 60000)
  resolve.lp('lp-path')
  resolve.options('options-path')
  await first
  assert.equal(appended.length, 3)
  assert.equal(timers.tasks.size, 3)
  scheduler.stop()
  assert.equal(timers.tasks.size, 0)
})

test('failure is sanitized, isolated and retried with bounded backoff', async () => {
  const timers = clock()
  let failures = 0
  const scheduler = createLiveScheduler({
    timers,
    collectors: {
      market: () => {
        failures++
        throw new Error('secret https://user:password@example.com/key')
      },
      lp: async () => 'lp',
      options: async () => 'options',
    },
    repository: { append: async () => {} },
  })
  await scheduler.start()
  assert.equal(scheduler.snapshot().market.error, 'collection-or-verification-failed')
  assert.equal(scheduler.snapshot().lp.phase, 'ready')
  assert.equal(scheduler.snapshot().options.phase, 'ready')
  let retry = [...timers.tasks.values()].find((item) => item.delay === 60000)
  retry.fn()
  await settle()
  assert.equal(failures, 2)
  assert.ok([...timers.tasks.values()].some((item) => item.delay === 120000))
  assert.ok(!JSON.stringify(scheduler.snapshot()).includes('password'))
  scheduler.stop()
})

test('stop aborts collectors and does not publish an in-flight result', async () => {
  let done
  let stopped = false
  let writes = 0
  const scheduler = createLiveScheduler({
    collectors: {
      market: () =>
        new Promise((resolve) => {
          done = resolve
        }),
      lp: async () => 'lp',
      options: async () => 'options',
      stop: () => {
        stopped = true
      },
    },
    repository: {
      append: async () => {
        writes++
      },
    },
  })
  const task = scheduler.start()
  await settle()
  assert.equal(writes, 2)
  scheduler.stop()
  done('late-market')
  await task
  assert.equal(writes, 2)
  assert.equal(stopped, true)
  assert.equal(scheduler.snapshot().market.nextRunAt, null)
})

test('archive quota pauses the affected lane without deleting history or scheduling more writes', async () => {
  const timers = clock()
  const scheduler = createLiveScheduler({
    timers,
    collectors: {
      market: async () => {
        throw Object.assign(new Error('quota'), { code: 'ARCHIVE_QUOTA' })
      },
      lp: async () => 'lp',
      options: async () => 'options',
    },
    repository: { append: async () => {} },
  })
  await scheduler.start()
  assert.equal(scheduler.snapshot().market.error, 'local-archive-quota-2GiB')
  assert.equal(scheduler.snapshot().market.nextRunAt, null)
  assert.equal(timers.tasks.size, 2)
  scheduler.stop()
})
