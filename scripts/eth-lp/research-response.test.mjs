import test from 'node:test'
import assert from 'node:assert/strict'
import { readBoundedResponseText } from '../research-response.mjs'

function trackedResponse(chunks, headers = {}) {
  let reads = 0
  let cancellations = 0
  const body = new ReadableStream(
    {
      pull(controller) {
        if (reads === chunks.length) controller.close()
        else controller.enqueue(chunks[reads++])
      },
      cancel() {
        cancellations += 1
      },
    },
    { highWaterMark: 0 },
  )
  return {
    response: new Response(body, { headers }),
    get reads() {
      return reads
    },
    get cancellations() {
      return cancellations
    },
  }
}

test('bounded streaming preserves UTF-8 across chunks and accepts the exact byte limit', async () => {
  const text = '{"值":"测试"}'
  const bytes = new TextEncoder().encode(text)
  const source = trackedResponse([bytes.slice(0, 4), bytes.slice(4, 7), bytes.slice(7)])
  assert.equal(await readBoundedResponseText(source.response, { maxBytes: bytes.length }), text)
  assert.equal(source.cancellations, 0)
})

test('chunked or understated responses stop at first overflow without reading the rest', async () => {
  for (const headers of [{}, { 'content-length': '1' }]) {
    const source = trackedResponse([new Uint8Array(3), new Uint8Array(3), new Uint8Array(100)], headers)
    await assert.rejects(
      readBoundedResponseText(source.response, { maxBytes: 5 }),
      (error) => error.code === 'RESPONSE_TOO_LARGE' && error.retryable === false,
    )
    assert.equal(source.reads, 2)
    assert.equal(source.cancellations, 1)
  }
})

test('declared oversized responses cancel before any bytes are pulled', async () => {
  const source = trackedResponse([new Uint8Array(100)], { 'content-length': '100' })
  await assert.rejects(readBoundedResponseText(source.response, { maxBytes: 5 }), /exceeds/)
  assert.equal(source.reads, 0)
  assert.equal(source.cancellations, 1)
})
