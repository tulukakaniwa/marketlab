/**
 * 品种 → 年交易日数（tdpy）自动判断
 *
 * 设计：返回 { value, basis, label }，basis 用于 UI 显示来源
 * 判定顺序：加密 → 港股 → A 股 → 美股 → fallback
 *   （港股优先于"全字母"判定，避免 .HK 被误判为美股）
 */

const TDPY = {
  crypto: { value: 365, basis: 'crypto', label: '加密 365' },
  us:     { value: 252, basis: 'us',     label: '美股 252' },
  hk:     { value: 242, basis: 'hk',     label: '港股 242' },
  cn:     { value: 242, basis: 'cn',     label: 'A 股 242' },
  fallback: { value: 365, basis: 'fallback', label: '默认 365' },
}

const CRYPTO_TOKENS = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL']

export function inferTdpy(sample) {
  if (!sample || typeof sample !== 'object') return { ...TDPY.fallback }
  const market = sample.market
  const symbol = String(sample.symbol || '').toUpperCase()

  // 1. 加密
  if (market === '加密') return { ...TDPY.crypto }
  if (CRYPTO_TOKENS.some((t) => symbol.includes(t))) return { ...TDPY.crypto }

  // 2. 港股优先于"全字母"判定（避免 .HK 走美股分支）
  if (market === '港股') return { ...TDPY.hk }
  if (/\.HK$/.test(symbol)) return { ...TDPY.hk }

  // 3. A 股
  if (market === 'A股') return { ...TDPY.cn }
  if (/^\d{6}$/.test(symbol)) return { ...TDPY.cn }

  // 4. 美股：纯字母 symbol
  if (market === '美股') return { ...TDPY.us }
  if (/^[A-Z]{1,5}$/.test(symbol)) return { ...TDPY.us }

  return { ...TDPY.fallback }
}
