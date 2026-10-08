/** Bound startup/paint waits and release listeners on every outcome. */
export function waitForChartOperation(operation, { signal, timeout = 8000, label = '图表启动' } = {}) {
  return new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new DOMException('图表初始化已取消', 'AbortError'))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => {
      cleanup()
      reject(new Error(`${label}等待超时`))
    }, timeout)
    Promise.resolve(operation).then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}
