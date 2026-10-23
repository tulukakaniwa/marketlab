// Count decoded HTTP body bytes while streaming. Neither Content-Length nor a
// full-buffer text()/json() read is sufficient for chunked/compressed responses.
export async function readBoundedResponseText(response, { maxBytes, errorPrefix = 'HTTP' }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid response byte limit')
  if (typeof response.body?.getReader !== 'function') {
    throw Object.assign(new Error(`${errorPrefix} response has no readable body`), { retryable: false })
  }
  const reader = response.body.getReader()
  const tooLarge = () =>
    Object.assign(new Error(`${errorPrefix} response exceeds ${maxBytes} byte limit`), {
      code: 'RESPONSE_TOO_LARGE',
      retryable: false,
    })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parts = []
  let bytes = 0
  try {
    const declared = response.headers?.get('content-length')
    if (declared && /^\d+$/.test(declared) && BigInt(declared) > BigInt(maxBytes)) throw tooLarge()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!(value instanceof Uint8Array)) {
        throw Object.assign(new Error(`${errorPrefix} response body is not bytes`), { retryable: false })
      }
      bytes += value.byteLength
      if (bytes > maxBytes) throw tooLarge()
      parts.push(decoder.decode(value, { stream: true }))
    }
    parts.push(decoder.decode())
    return parts.join('')
  } catch (error) {
    // Cancellation also releases the underlying fetch connection on overflow;
    // never replace the original error with a secondary cancellation failure.
    try {
      await reader.cancel()
    } catch {
      /* already closed or aborted */
    }
    throw error
  } finally {
    reader.releaseLock()
  }
}
