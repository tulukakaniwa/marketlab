export const LIVE_FILE_LIMIT = 100 * 1024 * 1024
export const LIVE_MANIFEST_LIMIT = 2 * 1024 * 1024
const kinds = ['market', 'lp', 'options']
const iso = (value) =>
  typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value))

export function isLoopbackPage(location = globalThis.location) {
  return (
    ['http:', 'https:'].includes(location?.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(location?.hostname)
  )
}

export function validateLiveManifest(value) {
  if (
    value?.version !== 1 ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    !iso(value.updatedAt) ||
    !Array.isArray(value.records) ||
    value.records.length > 864
  )
    throw new Error('持续采集清单格式无效')
  const seen = new Set()
  for (const record of value.records) {
    if (
      !kinds.includes(record?.kind) ||
      !/^[a-f0-9]{64}$/.test(record.id) ||
      record.id !== record.sha256 ||
      record.url !== `/bundles/${record.kind}/${record.id}` ||
      !iso(record.availableAt) ||
      !iso(record.receivedAt) ||
      Date.parse(record.receivedAt) > Date.parse(value.updatedAt) ||
      seen.has(record.id)
    )
      throw new Error('持续采集记录无效')
    seen.add(record.id)
  }
  return value
}

export async function readBoundedResponse(response, limit, signal) {
  if (!response.ok) throw new Error(`本地采集服务 HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length'))
  if (length > limit) throw new Error('持续采集响应超过大小限制')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('浏览器不支持有界流读取')
  const chunks = []
  let size = 0
  try {
    while (true) {
      if (signal.aborted) throw new Error('接入已取消')
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('持续采集响应超过大小限制')
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes.buffer
}

export function verifyLiveBundle({ record, buffer, workerFactory, signal, id }) {
  const envelope = JSON.parse(new TextDecoder().decode(buffer))
  if (envelope.sha256 !== record.sha256) return Promise.reject(new Error('清单与研究包 SHA256 不一致'))
  return new Promise((resolve, reject) => {
    const worker = workerFactory()
    let settled = false
    const timeout = setTimeout(() => finish(new Error('研究包核验超时')), 60000)
    function finish(error, result) {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
      worker.terminate()
      error ? reject(error) : resolve(result)
    }
    const abort = () => finish(new Error('接入已取消'))
    signal.addEventListener('abort', abort, { once: true })
    worker.onerror = () => finish(new Error('研究包计算失败'))
    worker.onmessage = ({ data }) => {
      if (data?.id !== id || !data.result) return
      const result = data.result
      const report = result.report
      const original = record.kind === 'options' ? report?.summary?.availableAt : report?.availableAt
      if (!result.hashVerified || !report || report.status === 'blocked' || original !== record.availableAt) {
        finish(new Error(result.issues?.join(' · ') || '研究包时间或完整性不匹配'))
      } else finish(null, report)
    }
    if (signal.aborted) abort()
    else worker.postMessage({ id, kind: record.kind, buffer, scenario: { enabled: false } }, [buffer])
  })
}
