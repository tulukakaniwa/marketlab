const loopback = (address) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address)
const localHost = (host) => {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

/** Dev-only access to the loopback collector; never a public dataset route. */
export function researchLiveDevGuard() {
  return {
    name: 'market-lab-local-research-feed',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        if (!pathname.startsWith('/api/research-live')) return next()
        if (
          request.method !== 'GET' ||
          !loopback(request.socket?.remoteAddress) ||
          !localHost(request.headers.host) ||
          (request.headers.origin && !localOrigin(request.headers.origin))
        ) {
          response.statusCode = 403
          response.end('Local research feed only')
          return
        }
        next()
      })
    },
  }
}

function localOrigin(origin) {
  try {
    const value = new URL(origin)
    return ['http:', 'https:'].includes(value.protocol) && localHost(value.host)
  } catch {
    return false
  }
}

export const researchLiveProxy = {
  target: 'http://127.0.0.1:5180',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/research-live/, ''),
  timeout: 20000,
  proxyTimeout: 20000,
}
