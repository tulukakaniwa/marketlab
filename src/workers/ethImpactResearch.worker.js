import { analyzeEthLpBundle } from '../domain/market-impact/ethLpResearch.js'
import { analyzeEthOptionsBundle } from '../domain/market-impact/ethOptionsResearch.js'
import { analyzeEthMarketBundle } from '../domain/market-impact/ethMarketSnapshot.js'

const FORMATS = {
  lp: 'market-lab-eth-lp-local-v1',
  options: 'market-lab-eth-options-local-v1',
  market: 'market-lab-eth-market-local-v1',
}
const MAX_BYTES = 100 * 1024 * 1024

export async function runEthImpactJob({ kind, buffer, scenario }, { digest = sha256, onVerified = () => {} } = {}) {
  let hashVerified = false
  try {
    if (!FORMATS[kind] || !(buffer instanceof ArrayBuffer) || buffer.byteLength > MAX_BYTES)
      throw new Error('unsupported-file-or-size')
    const envelope = JSON.parse(new TextDecoder().decode(buffer))
    if (envelope.format !== FORMATS[kind] || !envelope.bundle || !/^[a-f0-9]{64}$/.test(envelope.sha256))
      throw new Error('文件格式不匹配')
    const actual = await digest(JSON.stringify(envelope.bundle))
    if (actual !== envelope.sha256) throw new Error('SHA256 不匹配，文件内容未通过完整性校验')
    hashVerified = true
    onVerified()
    const analyzers = {
      lp: analyzeEthLpBundle,
      market: analyzeEthMarketBundle,
      options: (bundle) =>
        analyzeEthOptionsBundle(bundle, { enabled: false, hedgeRatio: 1, alreadyHedgedEth: 0, ...scenario }),
    }
    const report = analyzers[kind](envelope.bundle)
    return { report, hashVerified, issues: report.issues ?? [] }
  } catch (error) {
    return { report: null, hashVerified, issues: [error.message || '研究计算失败'] }
  }
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  self.onmessage = async ({ data }) => {
    const result = await runEthImpactJob(data, {
      onVerified: () => self.postMessage({ id: data.id, phase: 'computing' }),
    })
    self.postMessage({ id: data.id, result })
  }
}
